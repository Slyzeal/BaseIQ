// lib/adapters/moralis.ts
// Moralis adapter — PnL data ONLY (the one thing only Moralis provides free).
// All other wallet data is handled by baseData.ts (Basescan + RPC).

import { PnLSummary, TradeRecord } from "../types";
import { KeyPool } from "../keypool";
import { RawApprovalEvent } from "../approvals/scanner";

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

  const res = await fetch(`${MORALIS_BASE}${path}`, {
    headers: { "X-API-Key": key },
    signal: AbortSignal.timeout(15000),
  });

  if (res.status === 429 || res.status === 402) {
    p.bench(key);
    const next = p.next();
    if (!next) throw new Error("MORALIS_EXHAUSTED");
    return fetch(`${MORALIS_BASE}${path}`, { headers: { "X-API-Key": next } });
  }

  return res;
}

export async function fetchPnL(address: string): Promise<{ pnlSummary: PnLSummary; topTrades: TradeRecord[] } | null> {
  const [summaryRes, breakdownRes] = await Promise.allSettled([
    moralisFetch(`/wallets/${address}/profitability/summary?chain=${BASE_CHAIN}&days=all`),
    moralisFetch(`/wallets/${address}/profitability?chain=${BASE_CHAIN}&days=all`),
  ]);

  let pnlSummary: PnLSummary | null = null;
  if (summaryRes.status === "fulfilled" && summaryRes.value.ok) {
    const data = await summaryRes.value.json();
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

  const topTrades: TradeRecord[] = [];
  if (breakdownRes.status === "fulfilled" && breakdownRes.value.ok) {
    const data = await breakdownRes.value.json();
    const results: any[] = data.result ?? [];

    if (results.length > 0) {
      console.log("[PnL fields]", Object.keys(results[0]).join(", "));
    }

    for (const t of results) {
      const realizedProfit = parseFloat(t.realized_profit_usd ?? t.total_realized_profit_usd ?? "0") || 0;
      const totalInvested = parseFloat(t.total_usd_invested ?? t.total_invested_usd ?? "0") || 0;
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
    }

    topTrades.sort((a, b) => b.realizedProfitUsd - a.realizedProfitUsd);
  }

  if (!pnlSummary && topTrades.length === 0) return null;

  return {
    pnlSummary: pnlSummary ?? {
      totalRealizedProfitUsd: 0,
      totalRealizedProfitPct: 0,
      totalTradeCount: topTrades.length,
      totalBuys: 0,
      totalSells: 0,
      totalBoughtVolumeUsd: 0,
      totalSoldVolumeUsd: 0,
    },
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
  } catch { return []; }
}
