// lib/jeetEngine.ts
// Multiplier-based jeet tracker — fully free, no Moralis/Zerion needed.
// Pipeline:
// 1. Basescan tokentx — find ERC20 transfers OUT of wallet (sells)
// 2. GeckoTerminal — find top pool, get OHLCV at approximate sell date
// 3. DexScreener — current price
// 4. multiplier = currentPrice / sellPrice; keep if >= 1.5x

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
  timestamp: number;
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
  const byToken = new Map<string, SellEvent>();

  for (const tx of data.result) {
    if ((tx.from ?? "").toLowerCase() !== addrLower) continue;
    const to = (tx.to ?? "").toLowerCase();
    if (to === addrLower || to === "0x0000000000000000000000000000000000000000") continue;

    const decimals = parseInt(tx.tokenDecimal ?? "18");
    const amount = parseFloat(tx.value ?? "0") / Math.pow(10, decimals);
    if (amount <= 0) continue;

    const ts = parseInt(tx.timeStamp ?? "0");
    const existing = byToken.get(tx.contractAddress?.toLowerCase());

    // Keep the largest sell per token
    if (!existing || amount > existing.amountSold) {
      byToken.set(tx.contractAddress?.toLowerCase(), {
        tokenAddress: (tx.contractAddress ?? "").toLowerCase(),
        tokenSymbol: tx.tokenSymbol ?? "?",
        tokenName: tx.tokenName ?? "Unknown",
        amountSold: amount,
        timestamp: ts,
      });
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
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const pool = data.data?.[0]?.attributes?.address;
    if (pool) await cache.set(cacheKey, pool);
    return pool ?? null;
  } catch { return null; }
}

async function getHistoricalPrice(poolAddress: string, targetTimestamp: number): Promise<number> {
  const targetDay = Math.floor(targetTimestamp / 86400); // days since epoch
  const cacheKey = `gecko:price:${poolAddress}:${targetDay}`;
  const cached = await cache.get<number>(cacheKey);
  if (cached !== null && cached > 0) return cached;

  try {
    // Try day candles first (covers up to ~1 year)
    const res = await fetch(
      `${GECKO_BASE}/networks/base/pools/${poolAddress}/ohlcv/day?limit=365&before_timestamp=${targetTimestamp + 86400}`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return 0;
    const data = await res.json();
    const ohlcv: number[][] = data.data?.attributes?.ohlcv_list ?? [];

    if (ohlcv.length === 0) return 0;

    // Find closest candle to target timestamp
    let best = ohlcv[0];
    let bestDiff = Math.abs(ohlcv[0][0] - targetTimestamp);

    for (const candle of ohlcv) {
      const diff = Math.abs(candle[0] - targetTimestamp);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = candle;
      }
    }

    // Only use if within 7 days of the sell date
    if (bestDiff > 7 * 86400) return 0;

    const closePrice = best[4]; // OHLCV: [timestamp, open, high, low, close, volume]
    if (closePrice > 0) await cache.set(cacheKey, closePrice);
    return closePrice;
  } catch { return 0; }
}

async function getCurrentPrice(tokenAddress: string): Promise<number> {
  const cacheKey = `price:${tokenAddress}:now`;
  const cached = await cache.get<number>(cacheKey);
  if (cached && cached > 0) return cached;

  try {
    // Try DexScreener first
    const res = await fetch(`${DEX_BASE}/${tokenAddress}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      // Find Base chain pair with highest liquidity
      const basePairs = (data.pairs ?? []).filter((p: any) => p.chainId === "base");
      if (basePairs.length > 0) {
        basePairs.sort((a: any, b: any) => (parseFloat(b.liquidity?.usd ?? "0") - parseFloat(a.liquidity?.usd ?? "0")));
        const price = parseFloat(basePairs[0].priceUsd ?? "0") || 0;
        if (price > 0) {
          await cache.set(cacheKey, price);
          return price;
        }
      }
    }
  } catch {}

  // Fallback: GeckoTerminal current price
  try {
    const poolRes = await fetch(
      `${GECKO_BASE}/networks/base/tokens/${tokenAddress}/pools?page=1`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (poolRes.ok) {
      const poolData = await poolRes.json();
      const price = parseFloat(poolData.data?.[0]?.attributes?.base_token_price_usd ?? "0") || 0;
      if (price > 0) {
        await cache.set(cacheKey, price);
        return price;
      }
    }
  } catch {}

  return 0;
}

export async function detectJeets(address: string): Promise<JeetRecord[]> {
  try {
    const sells = await fetchSellEvents(address);
    if (sells.length === 0) return [];

    console.log(`[jeets] ${address.slice(0, 8)} found ${sells.length} sell events`);

    // Sort by amount sold desc — check biggest sells first
    sells.sort((a, b) => b.amountSold - a.amountSold);

    // Cap at 8 to respect GeckoTerminal rate limits
    const candidates = sells.slice(0, 8);
    const jeets: JeetRecord[] = [];

    for (const sell of candidates) {
      try {
        const poolAddress = await getTopPool(sell.tokenAddress);
        if (!poolAddress) {
          console.log(`[jeets] no pool for ${sell.tokenSymbol}`);
          continue;
        }

        const [soldAtPrice, currentPrice] = await Promise.all([
          getHistoricalPrice(poolAddress, sell.timestamp),
          getCurrentPrice(sell.tokenAddress),
        ]);

        console.log(`[jeets] ${sell.tokenSymbol}: sold@${soldAtPrice} now@${currentPrice}`);

        if (soldAtPrice <= 0 || currentPrice <= 0) continue;

        const multiplier = currentPrice / soldAtPrice;
        if (multiplier < 1.5) continue;

        const realizedAtSale = sell.amountSold * soldAtPrice;
        const currentValueIfHeld = sell.amountSold * currentPrice;
        const missedGains = currentValueIfHeld - realizedAtSale;

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
          missedGainsPct: ((currentPrice - soldAtPrice) / soldAtPrice) * 100,
          multiplier,
        });
      } catch (e) {
        console.error(`[jeets] error for ${sell.tokenSymbol}:`, e);
        continue;
      }
    }

    jeets.sort((a, b) => (b.multiplier ?? 0) - (a.multiplier ?? 0));
    console.log(`[jeets] ${address.slice(0, 8)} detected ${jeets.length} jeets`);
    return jeets.slice(0, 10);
  } catch (e) {
    console.error("[jeets] detectJeets failed:", e);
    return [];
  }
}
