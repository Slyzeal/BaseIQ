// lib/adapters/moralis.ts
// Primary data adapter — Moralis EVM API (free tier, indexer-based).
// Uses KeyPool for multi-key daily quota rotation.

import { WalletData, TokenHolding, NftHolding } from "../types";
import { KeyPool } from "../keypool";
import { RawApprovalEvent } from "../approvals/scanner";

const BASE_CHAIN = "0x2105"; // Base mainnet
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
    // Retry once with next key
    const next = p.next();
    if (!next) throw new Error("MORALIS_EXHAUSTED");
    return fetch(`${MORALIS_BASE}${path}`, {
      headers: { "X-API-Key": next },
    });
  }

  return res;
}

export async function fetchWalletData(address: string): Promise<WalletData> {
  const [tokensRes, nftsRes, txRes] = await Promise.allSettled([
    moralisFetch(`/${address}/erc20?chain=${BASE_CHAIN}&limit=100`),
    moralisFetch(`/${address}/nft?chain=${BASE_CHAIN}&limit=50`),
    moralisFetch(`/${address}?chain=${BASE_CHAIN}&limit=100`),
  ]);

  const tokens: TokenHolding[] = [];
  let spamCount = 0;

  if (tokensRes.status === "fulfilled" && tokensRes.value.ok) {
    const data = await tokensRes.value.json();
    for (const t of data.result ?? []) {
      const isSpam = t.possible_spam === true;
      if (isSpam) spamCount++;
      tokens.push({
        symbol: t.symbol ?? "?",
        name: t.name ?? "Unknown",
        contractAddress: t.token_address,
        balance: parseFloat(t.balance_formatted ?? "0"),
        usdValue: parseFloat(t.usd_value ?? "0"),
        isSpam,
        chain: "base",
      });
    }
  }

  const nfts: NftHolding[] = [];
  if (nftsRes.status === "fulfilled" && nftsRes.value.ok) {
    const data = await nftsRes.value.json();
    const byContract = new Map<string, number>();
    for (const n of data.result ?? []) {
      byContract.set(
        n.token_address,
        (byContract.get(n.token_address) ?? 0) + 1
      );
    }
    for (const [addr, count] of byContract.entries()) {
      nfts.push({ name: addr, contractAddress: addr, count });
    }
  }

  let totalTxCount = 0;
  let baseNativeTxCount = 0;
  let firstTxTimestamp: number | null = null;
  let lastTxTimestamp: number | null = null;
  const protocols = new Set<string>();
  let bridgeCount = 0;

  if (txRes.status === "fulfilled" && txRes.value.ok) {
    const data = await txRes.value.json();
    const txs = data.result ?? [];
    totalTxCount = data.total ?? txs.length;

    for (const tx of txs) {
      const ts = new Date(tx.block_timestamp).getTime();
      if (!firstTxTimestamp || ts < firstTxTimestamp) firstTxTimestamp = ts;
      if (!lastTxTimestamp || ts > lastTxTimestamp) lastTxTimestamp = ts;

      baseNativeTxCount++;

      // Heuristic protocol detection
      const to = (tx.to_address ?? "").toLowerCase();
      if (to.includes("bridge") || tx.input?.startsWith("0x")) bridgeCount++;
    }
  }

  const totalPortfolioUsd = tokens.reduce((s, t) => s + t.usdValue, 0);

  return {
    address,
    totalTxCount,
    uniqueContractsInteracted: Math.floor(totalTxCount * 0.4), // heuristic
    baseNativeTxCount,
    firstTxTimestamp,
    lastTxTimestamp,
    tokenHoldings: tokens,
    nftHoldings: nfts,
    totalPortfolioUsd,
    spamTokenCount: spamCount,
    defiProtocolsUsed: Array.from(protocols),
    bridgeCount,
  };
}

export async function fetchApprovals(
  address: string
): Promise<RawApprovalEvent[]> {
  try {
    const res = await moralisFetch(
      `/${address}/erc20/approvals?chain=${BASE_CHAIN}&limit=50`
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.result ?? []).map((e: any) => ({
      tokenAddress: e.token_address,
      tokenSymbol: e.token_symbol,
      spender: e.spender,
      value: e.value ?? "0",
    }));
  } catch {
    return [];
  }
}
