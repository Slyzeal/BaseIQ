// lib/adapters/moralis.ts
// Primary data adapter — Moralis EVM API (free tier).

import { WalletData, TokenHolding, NftHolding, PnLSummary, TradeRecord, JeetRecord } from "../types";
import { KeyPool } from "../keypool";
import { RawApprovalEvent } from "../approvals/scanner";
import { fetchTxSummary } from "./basescan";

const BASE_CHAIN = "0x2105";
const MORALIS_BASE = "https://deep-index.moralis.io/api/v2.2";

let pool: KeyPool | null = null;
function getPool(): KeyPool {
  if (!pool) pool = new KeyPool(process.env.MORALIS_API_KEY ?? "");
  return pool;
}

async function moralisFetch(path: string): Promise<Response> {
  const p = getPool();
  const key = p.next();
  if (!key) throw new Error("MORALIS_EXHAUSTED");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${MORALIS_BASE}${path}`, {
      headers: { "X-API-Key": key },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.status === 429 || res.status === 402) {
      p.bench(key);
      const next = p.next();
      if (!next) throw new Error("MORALIS_EXHAUSTED");
      return fetch(`${MORALIS_BASE}${path}`, { headers: { "X-API-Key": next } });
    }
    return res;
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

// Cache ETH price to avoid repeated Binance calls
let cachedEthPrice = 0;
let ethPriceFetchedAt = 0;

async function getEthPrice(): Promise<number> {
  if (cachedEthPrice > 0 && Date.now() - ethPriceFetchedAt < 5 * 60 * 1000) {
    return cachedEthPrice;
  }
  try {
    const res = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT");
    if (res.ok) {
      const data = await res.json();
      const price = parseFloat(data.price ?? "0");
      if (price > 0) {
        cachedEthPrice = price;
        ethPriceFetchedAt = Date.now();
        return price;
      }
    }
  } catch {}
  return cachedEthPrice || 3000; // last known or rough fallback
}

async function fetchTokenCurrentPrice(tokenAddress: string): Promise<number> {
  try {
    const res = await moralisFetch(`/erc20/${tokenAddress}/price?chain=${BASE_CHAIN}`);
    if (!res.ok) return 0;
    const data = await res.json();
    return parseFloat(data.usdPrice ?? "0") || 0;
  } catch { return 0; }
}

export async function fetchWalletData(address: string): Promise<WalletData> {
  // Tier 1: Critical — stats + txlist
  const [statsRes, txRes] = await Promise.allSettled([
    moralisFetch(`/wallets/${address}/stats?chain=${BASE_CHAIN}`),
    moralisFetch(`/${address}?chain=${BASE_CHAIN}&limit=100`),
  ]);

  // Tier 2: Supporting data
  const [tokensRes, nftsRes, nativeRes, pnlSummaryRes, pnlBreakdownRes] =
    await Promise.allSettled([
      moralisFetch(`/${address}/erc20?chain=${BASE_CHAIN}&limit=100`),
      moralisFetch(`/${address}/nft?chain=${BASE_CHAIN}&limit=50`),
      moralisFetch(`/${address}/balance?chain=${BASE_CHAIN}`),
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
      if (isSpam) { spamCount++; continue; }
      const balance = parseFloat(t.balance_formatted ?? "0") || 0;
      if (balance <= 0) continue;
      const usdPrice = parseFloat(t.usd_price ?? "0") || 0;
      const usdValue = parseFloat(t.usd_value ?? "0") || (balance * usdPrice) || 0;
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

  // ── Native ETH balance + Binance price ───────────────────────────────────
  if (nativeRes.status === "fulfilled" && nativeRes.value.ok) {
    const data = await nativeRes.value.json();
    const ethBalance = parseFloat(data.balance ?? "0") / 1e18;
    if (ethBalance > 0.00001) {
      const ethPrice = await getEthPrice();
      tokens.unshift({
        symbol: "ETH",
        name: "Ethereum",
        contractAddress: "native",
        balance: ethBalance,
        usdValue: ethBalance * ethPrice,
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
  let parsedTxs: any[] = [];

  // Stats first — most reliable tx count
  if (statsRes.status === "fulfilled" && statsRes.value.ok) {
    const stats = await statsRes.value.json();
    // Moralis v2.2 stats structure: { transactions: { total: N } }
    const realCount =
      stats.transactions?.total ??
      stats.nativeTransactions?.total ??
      stats.native_transactions_count ??
      0;
    if (realCount > 0) {
      totalTxCount = realCount;
      baseNativeTxCount = realCount;
    }
    console.log("[stats] raw:", JSON.stringify(stats).slice(0, 200));
  }

  // Tx list for timestamps + interactions
  if (txRes.status === "fulfilled" && txRes.value.ok) {
    const data = await txRes.value.json();
    parsedTxs = data.result ?? [];
    if (totalTxCount === 0) totalTxCount = parsedTxs.length;
    if (baseNativeTxCount === 0) baseNativeTxCount = parsedTxs.length;

    for (const tx of parsedTxs) {
      const ts = new Date(tx.block_timestamp).getTime();
      if (!firstTxTimestamp || ts < firstTxTimestamp) firstTxTimestamp = ts;
      if (!lastTxTimestamp || ts > lastTxTimestamp) lastTxTimestamp = ts;
      const to = (tx.to_address ?? "").toLowerCase();
      if (to) contractsInteracted.add(to);
      if (KNOWN_BASE_BRIDGES[to]) { bridgeCount++; protocols.add(KNOWN_BASE_BRIDGES[to]); }
      if (KNOWN_BASE_PROTOCOLS[to]) protocols.add(KNOWN_BASE_PROTOCOLS[to]);
    }
  }

  // Contract deployments from Moralis tx list
  let contractsDeployed = 0;
  let deployedContractAddresses: string[] = [];
  for (const tx of parsedTxs) {
    if ((!tx.to_address || tx.to_address === "") && tx.receipt_contract_address) {
      if (!deployedContractAddresses.includes(tx.receipt_contract_address)) {
        deployedContractAddresses.push(tx.receipt_contract_address);
        contractsDeployed++;
      }
    }
  }

  // ── Basescan enrichment ───────────────────────────────────────────────────
  const basescanSummary = await fetchTxSummary(address).catch(() => null);
  if (basescanSummary) {
    if (basescanSummary.totalTxCount > totalTxCount) {
      totalTxCount = basescanSummary.totalTxCount;
      baseNativeTxCount = basescanSummary.totalTxCount;
    }
    if (basescanSummary.firstTxTimestamp) firstTxTimestamp = basescanSummary.firstTxTimestamp;
    if (basescanSummary.lastTxTimestamp) lastTxTimestamp = basescanSummary.lastTxTimestamp;
    for (const c of basescanSummary.uniqueContractsInteracted) contractsInteracted.add(c);
    bridgeCount = Math.max(bridgeCount, basescanSummary.bridgeCount);
    for (const label of basescanSummary.contractLabels.values()) protocols.add(label);
    // Merge deployments
    for (const addr of basescanSummary.deployedContractAddresses) {
      if (!deployedContractAddresses.includes(addr)) {
        deployedContractAddresses.push(addr);
        contractsDeployed++;
      }
    }
  }

  // ── PnL Summary ───────────────────────────────────────────────────────────
  let pnlSummary: PnLSummary | null = null;
  if (pnlSummaryRes.status === "fulfilled" && pnlSummaryRes.value.ok) {
    const data = await pnlSummaryRes.value.json();
    if (data && typeof data.total_count_of_trades !== "undefined") {
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

  // ── PnL Breakdown + Jeet Detection ───────────────────────────────────────
  const topTrades: TradeRecord[] = [];
  const jeetCandidates: Array<{ t: any; avgSellPrice: number; totalSold: number }> = [];

  if (pnlBreakdownRes.status === "fulfilled" && pnlBreakdownRes.value.ok) {
    const data = await pnlBreakdownRes.value.json();
    const results: any[] = data.result ?? [];

    if (results.length > 0) {
      console.log("[PnL fields]", Object.keys(results[0]).join(", "));
    }

    for (const t of results) {
      const realizedProfit = parseFloat(
        t.realized_profit_usd ?? t.total_realized_profit_usd ?? t.realized_profit ?? "0"
      ) || 0;
      const totalInvested = parseFloat(
        t.total_usd_invested ?? t.total_invested_usd ?? t.buy_amount_usd ?? "0"
      ) || 0;
      const totalSold = parseFloat(t.total_tokens_sold ?? "0") || 0;
      const avgBuyPrice = parseFloat(t.avg_buy_price_usd ?? t.average_buy_price_usd ?? "0") || 0;
      const avgSellPrice = parseFloat(t.avg_sell_price_usd ?? t.average_sell_price_usd ?? "0") || 0;
      const roiPct = totalInvested > 0 ? (realizedProfit / totalInvested) * 100 : 0;

      topTrades.push({
        tokenSymbol: t.symbol ?? "?",
        tokenName: t.name ?? "Unknown",
        realizedProfitUsd: realizedProfit,
        totalInvestedUsd: totalInvested,
        avgBuyPriceUsd: avgBuyPrice,
        avgSellPriceUsd: avgSellPrice,
        totalBought: parseFloat(t.total_tokens_bought ?? "0") || 0,
        totalSold,
        isWin: realizedProfit > 0,
        roiPct,
      });

      // Queue jeet candidates — only if sold tokens with a known sell price
      if (totalSold > 0 && avgSellPrice > 0 && t.token_address) {
        jeetCandidates.push({ t, avgSellPrice, totalSold });
      }
    }

    topTrades.sort((a, b) => b.realizedProfitUsd - a.realizedProfitUsd);

    // Jeet detection — limit to top 5 candidates to save CU
    const jeets: JeetRecord[] = [];
    const topCandidates = jeetCandidates
      .sort((a, b) => b.totalSold * b.avgSellPrice - a.totalSold * a.avgSellPrice)
      .slice(0, 5);

    for (const { t, avgSellPrice, totalSold } of topCandidates) {
      const currentPrice = await fetchTokenCurrentPrice(t.token_address);
      if (currentPrice > avgSellPrice * 1.2) {
        const currentValueIfHeld = totalSold * currentPrice;
        const realizedAtSale = totalSold * avgSellPrice;
        const missedGains = currentValueIfHeld - realizedAtSale;
        jeets.push({
          tokenSymbol: t.symbol ?? "?",
          tokenName: t.name ?? "Unknown",
          tokenAddress: t.token_address,
          soldAtPrice: avgSellPrice,
          currentPrice,
          amountSold: totalSold,
          realizedAtSale,
          currentValueIfHeld,
          missedGains,
          missedGainsPct: ((currentPrice - avgSellPrice) / avgSellPrice) * 100,
        });
      }
    }

    jeets.sort((a, b) => b.missedGains - a.missedGains);

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
      contractsDeployed,
      deployedContractAddresses,
      pnlSummary,
      topTrades,
      jeets: jeets.slice(0, 10),
    };
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
    contractsDeployed,
    deployedContractAddresses,
    pnlSummary,
    topTrades,
    jeets: [],
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
  } catch { return []; }
}

const KNOWN_BASE_BRIDGES: Record<string, string> = {
  "0x3154cf16ccdb4c6d922629664174b904d80f2c35": "Base Bridge",
  "0x49048044d57e1c92a77f79988d21fa8faf74e97e": "Base Bridge",
  "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae": "LiFi Bridge",
  "0x3a23f943181408eac424116af7b7790c94cb97a5": "Socket Bridge",
  "0x9de443adc5a411e83f1878ef24c3f52c61571e72": "Stargate",
};

const KNOWN_BASE_PROTOCOLS: Record<string, string> = {
  "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24": "Uniswap V3",
  "0x2626664c2603336e57b271c5c0b26f421741e481": "Uniswap V3",
  "0x6ff5693b99212da76ad316178a184ab56d299b43": "Aerodrome",
  "0x420dd381b31aef6683db6b902084cb0ffece40da": "Aerodrome",
  "0x940181a94a35a4569e4529a3cdfb74e38fd98631": "Aerodrome",
};
