// lib/jeetEngine.ts
// Multiplier-based jeet tracker — fully free, no Moralis/Zerion needed.
// Pipeline:
// 1. Basescan tokentx — find ERC20 transfers OUT of wallet (sells)
// 2. GeckoTerminal — find top pool for token, get OHLCV at sell date (historical price)
// 3. DexScreener — current price
// 4. multiplier = currentPrice / sellPrice; keep if >= 1.5x
// All prices cached in Redis. Max 8 token lookups per scan to respect GeckoTerminal 30 req/min.

import { cache } from "./cache";
import { JeetRecord } from "./types";

const BASESCAN_BASE = "https://api.basescan.org/api";
const GECKO_BASE = "https://api.geckoterminal.com/api/v2";
const DEX_BASE = "https://api.dexscreener.com/latest/dex/tokens";

async function basescanFetch(params: Record<string, string>): Promise<any> {
  const apiKey = process.env.BASESCAN_API_KEY;
  if (!apiKey) return null;
  const query = new URLSearchParams({ ...params, apikey: apiKey });
  try {
    const res = await fetch(`${BASESCAN_BASE}?${query.toString()}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status === "0" && data.message !== "No transactions found") return null;
    return data;
  } catch { return null; }
}

interface SellEvent {
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  amountSold: number;
  timestamp: number; // unix seconds
  dateStr: string;   // YYYY-MM-DD for OHLCV lookup
}

async function fetchSellEvents(address: string): Promise<SellEvent[]> {
  const data = await basescanFetch({
    module: "account",
    action: "tokentx",
    address,
    page: "1",
    offset: "200",
    sort: "desc",
  });

  if (!data?.result) return [];

  const addrLower = address.toLowerCase();
  const sells: SellEvent[] = [];

  for (const tx of data.result) {
    // Only outbound transfers (sells/sends)
    if ((tx.from ?? "").toLowerCase() !== addrLower) continue;
    // Skip if sending to own address or zero address
    const to = (tx.to ?? "").toLowerCase();
    if (to === addrLower || to === "0x0000000000000000000000000000000000000000") continue;

    const decimals = parseInt(tx.tokenDecimal ?? "18");
    const amount = parseFloat(tx.value ?? "0") / Math.pow(10, decimals);
    if (amount <= 0) continue;

    const ts = parseInt(tx.timeStamp ?? "0");
    const date = new Date(ts * 1000);
    const dateStr = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;

    sells.push({
      tokenAddress: (tx.contractAddress ?? "").toLowerCase(),
      tokenSymbol: tx.tokenSymbol ?? "?",
      tokenName: tx.tokenName ?? "Unknown",
      amountSold: amount,
      timestamp: ts,
      dateStr,
    });
  }

  // Group by token — take largest single outflow per token
  const byToken = new Map<string, SellEvent>();
  for (const s of sells) {
    const existing = byToken.get(s.tokenAddress);
    if (!existing || s.amountSold > existing.amountSold) {
      byToken.set(s.tokenAddress, s);
    }
  }

  return Array.from(byToken.values());
}

async function getTopPool(tokenAddress: string): Promise<string | null> {
  const cacheKey = `gecko:pool:${tokenAddress}`;
  const cached = await cache.get<string>(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch(
      `${GECKO_BASE}/networks/base/tokens/${tokenAddress}/pools?page=1`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const pool = data.data?.[0]?.attributes?.address;
    if (pool) await cache.set(cacheKey, pool);
    return pool ?? null;
  } catch { return null; }
}

async function getHistoricalPrice(poolAddress: string, dateStr: string): Promise<number> {
  const cacheKey = `gecko:price:${poolAddress}:${dateStr}`;
  const cached = await cache.get<number>(cacheKey);
  if (cached !== null) return cached;

  try {
    const res = await fetch(
      `${GECKO_BASE}/networks/base/pools/${poolAddress}/ohlcv/day?limit=365`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return 0;
    const data = await res.json();
    const ohlcv: Array<[number, number, number, number, number, number]> = data.data?.attributes?.ohlcv_list ?? [];

    // Find candle matching the date
    for (const candle of ohlcv) {
      const candleDate = new Date(candle[0] * 1000);
      const candleDateStr = `${candleDate.getUTCFullYear()}-${String(candleDate.getUTCMonth() + 1).padStart(2, "0")}-${String(candleDate.getUTCDate()).padStart(2, "0")}`;
      if (candleDateStr === dateStr) {
        const closePrice = candle[4]; // OHLCV: [timestamp, open, high, low, close, volume]
        if (closePrice > 0) await cache.set(cacheKey, closePrice);
        return closePrice;
      }
    }

    // If exact date not found, use nearest candle
    if (ohlcv.length > 0) {
      const targetTs = new Date(dateStr).getTime() / 1000;
      let nearest = ohlcv[0];
      for (const candle of ohlcv) {
        if (Math.abs(candle[0] - targetTs) < Math.abs(nearest[0] - targetTs)) {
          nearest = candle;
        }
      }
      const price = nearest[4];
      if (price > 0) await cache.set(cacheKey, price);
      return price;
    }

    return 0;
  } catch { return 0; }
}

async function getCurrentPrice(tokenAddress: string): Promise<number> {
  const cacheKey = `price:${tokenAddress}:now`;
  const cached = await cache.get<number>(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch(`${DEX_BASE}/${tokenAddress}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return 0;
    const data = await res.json();
    const pair = data.pairs?.find((p: any) => p.chainId === "base");
    const price = parseFloat(pair?.priceUsd ?? "0") || 0;
    if (price > 0) await cache.set(cacheKey, price);
    return price;
  } catch { return 0; }
}

export async function detectJeets(address: string): Promise<JeetRecord[]> {
  const sells = await fetchSellEvents(address);
  if (sells.length === 0) return [];

  // Sort by amountSold descending — check biggest sells first
  sells.sort((a, b) => b.amountSold - a.amountSold);

  // Cap at 8 token lookups to respect GeckoTerminal rate limits
  const candidates = sells.slice(0, 8);
  const jeets: JeetRecord[] = [];

  for (const sell of candidates) {
    try {
      // Get pool address
      const poolAddress = await getTopPool(sell.tokenAddress);
      if (!poolAddress) continue; // no pool = skip (not a real traded token)

      // Get prices in parallel
      const [soldAtPrice, currentPrice] = await Promise.all([
        getHistoricalPrice(poolAddress, sell.dateStr),
        getCurrentPrice(sell.tokenAddress),
      ]);

      if (soldAtPrice <= 0 || currentPrice <= 0) continue;

      const multiplier = currentPrice / soldAtPrice;
      if (multiplier < 1.5) continue; // only show 1.5x+ jeets

      const realizedAtSale = sell.amountSold * soldAtPrice;
      const currentValueIfHeld = sell.amountSold * currentPrice;
      const missedGains = currentValueIfHeld - realizedAtSale;
      const missedGainsPct = ((currentPrice - soldAtPrice) / soldAtPrice) * 100;

      jeets.push({
        tokenSymbol: sell.tokenSymbol,
        tokenName: sell.tokenName,
        tokenAddress: sell.tokenAddress,
        soldAtPrice,
        currentPrice,
        amountSold: sell.amountSold,
        realizedAtSale,
        currentValueIfHeld,
        missedGains,
        missedGainsPct,
        multiplier,
      });
    } catch { continue; }
  }

  // Sort by multiplier desc — biggest misses first
  jeets.sort((a, b) => (b.multiplier ?? 0) - (a.multiplier ?? 0));
  return jeets.slice(0, 10);
}
