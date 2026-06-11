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
    moralisFetch(`/${address}/erc20?chain=${BASE_CHAIN}&limit=100&exclude_spam=false`),
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

      // Moralis free tier: usd_value may be null — use usd_price * balance as fallback
      const balance = parseFloat(t.balance_formatted ?? "0") || 0;
      const usdPrice = parseFloat(t.usd_price ?? "0") || 0;
      const usdValue = parseFloat(t.usd_value ?? "0") || (balance * usdPrice) || 0;

      tokens.push({
        symbol: t.symbol ?? "?",
        name: t.name ?? "Unknown",
        contractAddress: t.token_address,
        balance,
        usdValue,
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
  const contractsInteracted = new Set<string>();

  if (txRes.status === "fulfilled" && txRes.value.ok) {
    const data = await txRes.value.json();
    const txs = data.result ?? [];

    // Use cursor-based total if available, otherwise use page total
    totalTxCount = typeof data.total === "number" ? data.total : txs.length;

    for (const tx of txs) {
      const ts = new Date(tx.block_timestamp).getTime();
      if (!firstTxTimestamp || ts < firstTxTimestamp) firstTxTimestamp = ts;
      if (!lastTxTimestamp || ts > lastTxTimestamp) lastTxTimestamp = ts;

      baseNativeTxCount++;

      const to = (tx.to_address ?? "").toLowerCase();
      contractsInteracted.add(to);

      // Bridge heuristic — large input data usually means contract interaction
      if (tx.input && tx.input.length > 10) bridgeCount++;

      // Protocol detection from known Base DeFi addresses
      if (KNOWN_BASE_PROTOCOLS[to]) {
        protocols.add(KNOWN_BASE_PROTOCOLS[to]);
      }
    }
  }

  // If totalTxCount came from data.total, baseNativeTxCount is the page count
  // Use the larger of the two for more accurate scoring
  if (totalTxCount > baseNativeTxCount) {
    baseNativeTxCount = totalTxCount;
  }

  const totalPortfolioUsd = tokens
    .filter((t) => !t.isSpam)
    .reduce((s, t) => s + (isNaN(t.usdValue) ? 0 : t.usdValue), 0);

  return {
    address,
    totalTxCount,
    uniqueContractsInteracted: contractsInteracted.size || Math.floor(totalTxCount * 0.4),
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

// Known Base DeFi protocol addresses (partial list)
const KNOWN_BASE_PROTOCOLS: Record<string, string> = {
  "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24": "Uniswap",
  "0x2626664c2603336e57b271c5c0b26f421741e481": "Uniswap",
  "0x6ff5693b99212da76ad316178a184ab56d299b43": "Aerodrome",
  "0x420dd381b31aef6683db6b902084cb0ffece40da": "Aerodrome",
  "0x3a23f943181408eac424116af7b7790c94cb97a5": "Socket Bridge",
  "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae": "LiFi Bridge",
  "0x9c52b5b1a9f6a20b06f6b2c0bef3f0b0e6d4c5a2": "Stargate",
};
