// lib/adapters/moralis.ts
// Primary data adapter — Moralis EVM API (free tier, indexer-based).
// Uses KeyPool for multi-key daily quota rotation.

import { WalletData, TokenHolding, NftHolding, PnLSummary, TradeRecord } from "../types";
import { fetchTxSummary } from "./basescan";
import { KeyPool } from "../keypool";
import { RawApprovalEvent } from "../approvals/scanner";

const BASE_CHAIN = "0x2105"; // Base mainnet chain ID
const MORALIS_BASE = "https://deep-index.moralis.io/api/v2.2";

let pool: KeyPool | null = null;

function getPool(): KeyPool {
  if (!pool) {
    const keys = process.env.MORALIS_API_KEY ?? "";
    pool = new KeyPool(keys);
  }
  return pool;
}

async function moralisFetch(path: string): Promise<Response> {
  const p = getPool();
  const key = p.next();
  if (!key) throw new Error("MORALIS_EXHAUSTED");

  const res = await fetch(`${MORALIS_BASE}${path}`, {
    headers: { "X-API-Key": key },
  });

  if (res.status === 429 || res.status === 402) {
    p.bench(key);
    const next = p.next();
    if (!next) throw new Error("MORALIS_EXHAUSTED");
    return fetch(`${MORALIS_BASE}${path}`, {
      headers: { "X-API-Key": next },
    });
  }

  return res;
}

export async function fetchWalletData(address: string): Promise<WalletData> {
  // Fire all requests in parallel
  const [tokensRes, nftsRes, txRes, nativeRes, statsRes, pnlSummaryRes, pnlBreakdownRes] =
    await Promise.allSettled([
      moralisFetch(`/${address}/erc20?chain=${BASE_CHAIN}&limit=100`),
      moralisFetch(`/${address}/nft?chain=${BASE_CHAIN}&limit=50`),
      moralisFetch(`/${address}?chain=${BASE_CHAIN}&limit=100`),
      moralisFetch(`/${address}/balance?chain=${BASE_CHAIN}`),
      moralisFetch(`/wallets/${address}/stats?chain=${BASE_CHAIN}`),
      moralisFetch(`/wallets/${address}/profitability/summary?chain=${BASE_CHAIN}&days=all`),
      moralisFetch(`/wallets/${address}/profitability?chain=${BASE_CHAIN}&days=all`),
    ]);

  // ── ERC20 tokens ──────────────────────────────────────────────────────────
  const tokens: TokenHolding[] = [];
  let spamCount = 0;

  if (tokensRes.status === "fulfilled" && tokensRes.value.ok) {
    const data = await tokensRes.value.json();
    for (const t of data.result ?? []) {
      const isSpam = t.possible_spam === true;
      if (isSpam) { spamCount++; continue; } // skip spam entirely

      const balance = parseFloat(t.balance_formatted ?? "0") || 0;
      const usdPrice = parseFloat(t.usd_price ?? "0") || 0;
      const usdValue = parseFloat(t.usd_value ?? "0") || (balance * usdPrice) || 0;

      if (balance <= 0) continue; // skip zero-balance tokens

      tokens.push({
        symbol: t.symbol ?? "?",
        name: t.name ?? "Unknown",
        contractAddress: t.token_address,
        balance,
        usdValue,
        isSpam: false,
        chain: "base",
      });
    }
  }

  // ── Native ETH balance ────────────────────────────────────────────────────
  if (nativeRes.status === "fulfilled" && nativeRes.value.ok) {
    const data = await nativeRes.value.json();
    const ethWei = parseFloat(data.balance ?? "0");
    const ethBalance = ethWei / 1e18;
    if (ethBalance > 0.00001) {
      // Moralis balance endpoint doesn't include price — use usd_value if present
      const usdValue = parseFloat(data.usd_value ?? "0") || 0;
      tokens.unshift({
        symbol: "ETH",
        name: "Ethereum",
        contractAddress: "native",
        balance: ethBalance,
        usdValue,
        isSpam: false,
        chain: "base",
      });
    }
  }

  // ── NFTs ──────────────────────────────────────────────────────────────────
  const nfts: NftHolding[] = [];
  if (nftsRes.status === "fulfilled" && nftsRes.value.ok) {
    const data = await nftsRes.value.json();
    const byContract = new Map<string, number>();
    for (const n of data.result ?? []) {
      byContract.set(n.token_address, (byContract.get(n.token_address) ?? 0) + 1);
    }
    for (const [addr, count] of byContract.entries()) {
      nfts.push({ name: addr, contractAddress: addr, count });
    }
  }

  // ── Transactions ──────────────────────────────────────────────────────────
  let totalTxCount = 0;
  let baseNativeTxCount = 0;
  let firstTxTimestamp: number | null = null;
  let lastTxTimestamp: number | null = null;
  const protocols = new Set<string>();
  let bridgeCount = 0;
  const contractsInteracted = new Set<string>();

  if (txRes.status === "fulfilled" && txRes.value.ok) {
    const data = await txRes.value.json();
    const txs: any[] = data.result ?? [];
    totalTxCount = txs.length;

    for (const tx of txs) {
      const ts = new Date(tx.block_timestamp).getTime();
      if (!firstTxTimestamp || ts < firstTxTimestamp) firstTxTimestamp = ts;
      if (!lastTxTimestamp || ts > lastTxTimestamp) lastTxTimestamp = ts;

      baseNativeTxCount++;

      const to = (tx.to_address ?? "").toLowerCase();
      if (to) contractsInteracted.add(to);

      // Bridge detection
      if (tx.input && tx.input.length > 10) bridgeCount++;

      // Known protocol detection
      if (KNOWN_BASE_PROTOCOLS[to]) {
        protocols.add(KNOWN_BASE_PROTOCOLS[to]);
      }
    }
  }

  // ── Real tx count from stats endpoint ────────────────────────────────────
  if (statsRes.status === "fulfilled" && statsRes.value.ok) {
    const stats = await statsRes.value.json();
    // Moralis stats returns { transactions: { total: N } }
    const realCount = stats.transactions?.total ?? stats.native_transactions_count ?? 0;
    if (realCount > 0) {
      totalTxCount = realCount;
      baseNativeTxCount = realCount;
    }
  }

  // ── Basescan tx enrichment (more accurate tx count + timestamps) ─────────
  const basescanSummary = await fetchTxSummary(address).catch(() => null);
  if (basescanSummary) {
    totalTxCount = basescanSummary.totalTxCount > totalTxCount
      ? basescanSummary.totalTxCount
      : totalTxCount;
    baseNativeTxCount = totalTxCount;
    if (basescanSummary.firstTxTimestamp) firstTxTimestamp = basescanSummary.firstTxTimestamp;
    if (basescanSummary.lastTxTimestamp) lastTxTimestamp = basescanSummary.lastTxTimestamp;
    if (basescanSummary.uniqueContractsInteracted.size > contractsInteracted.size) {
      for (const c of basescanSummary.uniqueContractsInteracted) contractsInteracted.add(c);
    }
    bridgeCount = Math.max(bridgeCount, basescanSummary.bridgeCount);
    // Add labeled protocol names
    for (const label of basescanSummary.contractLabels.values()) {
      protocols.add(label);
    }
  }

  // ── PnL Summary ───────────────────────────────────────────────────────────
  let pnlSummary: PnLSummary | null = null;
  if (pnlSummaryRes.status === "fulfilled" && pnlSummaryRes.value.ok) {
    const data = await pnlSummaryRes.value.json();
    if (data && typeof data.total_realized_profit_usd !== "undefined") {
      pnlSummary = {
        totalRealizedProfitUsd: parseFloat(data.total_realized_profit_usd ?? "0") || 0,
        totalRealizedProfitPct: parseFloat(data.total_realized_profit_percentage ?? "0") || 0,
        totalTradeCount: data.total_count_of_trades ?? 0,
        totalBuys: data.total_buys ?? 0,
        totalSells: data.total_sells ?? 0,
        totalBoughtVolumeUsd: parseFloat(data.total_bought_volume_usd ?? "0") || 0,
        totalSoldVolumeUsd: parseFloat(data.total_sold_volume_usd ?? "0") || 0,
      };
    }
  }

  // ── PnL Breakdown — top trades ────────────────────────────────────────────
  const topTrades: TradeRecord[] = [];
  if (pnlBreakdownRes.status === "fulfilled" && pnlBreakdownRes.value.ok) {
    const data = await pnlBreakdownRes.value.json();
    const results: any[] = data.result ?? [];

    for (const t of results) {
      const realizedProfit = parseFloat(t.realized_profit_usd ?? "0") || 0;
      const totalInvested = parseFloat(t.total_usd_invested ?? "0") || 0;
      const roiPct = totalInvested > 0
        ? ((realizedProfit / totalInvested) * 100)
        : 0;

      topTrades.push({
        tokenSymbol: t.symbol ?? "?",
        tokenName: t.name ?? "Unknown",
        realizedProfitUsd: realizedProfit,
        totalInvestedUsd: totalInvested,
        avgBuyPriceUsd: parseFloat(t.avg_buy_price_usd ?? "0") || 0,
        avgSellPriceUsd: parseFloat(t.avg_sell_price_usd ?? "0") || 0,
        totalBought: parseFloat(t.total_tokens_bought ?? "0") || 0,
        totalSold: parseFloat(t.total_tokens_sold ?? "0") || 0,
        isWin: realizedProfit > 0,
        roiPct,
      });
    }

    // Sort by realized profit descending — biggest wins first
    topTrades.sort((a, b) => b.realizedProfitUsd - a.realizedProfitUsd);
  }

  const totalPortfolioUsd = tokens.reduce((s, t) => s + (isNaN(t.usdValue) ? 0 : t.usdValue), 0);

  return {
    address,
    totalTxCount,
    uniqueContractsInteracted: contractsInteracted.size || Math.floor(totalTxCount * 0.3),
    baseNativeTxCount,
    firstTxTimestamp,
    lastTxTimestamp,
    tokenHoldings: tokens,
    nftHoldings: nfts,
    totalPortfolioUsd,
    spamTokenCount: spamCount,
    defiProtocolsUsed: Array.from(protocols),
    bridgeCount,
    pnlSummary,
    topTrades,
  };
}

export async function fetchApprovals(address: string): Promise<RawApprovalEvent[]> {
  try {
    const res = await moralisFetch(`/${address}/erc20/approvals?chain=${BASE_CHAIN}&limit=50`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.result ?? []).map((e: any) => ({
      tokenAddress: e.token_address,
      tokenSymbol: e.token_symbol ?? "?",
      spender: e.spender,
      value: e.value ?? "0",
    }));
  } catch {
    return [];
  }
}

// Known Base DeFi protocol addresses
const KNOWN_BASE_PROTOCOLS: Record<string, string> = {
  "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24": "Uniswap V3",
  "0x2626664c2603336e57b271c5c0b26f421741e481": "Uniswap V3",
  "0x6ff5693b99212da76ad316178a184ab56d299b43": "Aerodrome",
  "0x420dd381b31aef6683db6b902084cb0ffece40da": "Aerodrome",
  "0x3a23f943181408eac424116af7b7790c94cb97a5": "Socket Bridge",
  "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae": "LiFi Bridge",
  "0x3154cf16ccdb4c6d922629664174b904d80f2c35": "Base Bridge",
  "0x49048044d57e1c92a77f79988d21fa8faf74e97e": "Base Bridge",
  "0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0": "Polygon Bridge",
  "0x4200000000000000000000000000000000000006": "WETH",
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": "USDC",
};
 
