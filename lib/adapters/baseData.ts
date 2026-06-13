// lib/adapters/baseData.ts
// Primary free-tier data adapter — composes Basescan + RPC pool.
// No Moralis needed for core wallet data.
// Provides: tx count, timestamps, deployments, balances, bridge/protocol detection.

import { WalletData } from "../types";
import { KeyPool } from "../keypool";
import { fetchTokenBalances } from "./rpcTokens";
import { getTxCount } from "./rpcPool";

const BASESCAN_BASE = "https://api.basescan.org/api";

let basescanPool: KeyPool | null = null;
function getBasescanPool(): KeyPool | null {
  const keys = process.env.BASESCAN_API_KEY ?? "";
  if (!keys) return null;
  if (!basescanPool) basescanPool = new KeyPool(keys);
  return basescanPool;
}

async function basescanFetch(params: Record<string, string>): Promise<any> {
  const pool = getBasescanPool();
  if (!pool) return null;
  const key = pool.next();
  if (!key) return null;

  const query = new URLSearchParams({ ...params, apikey: key });
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

// Blockscout fallback — same Etherscan-compatible API, different quota
async function blockscoutFetch(params: Record<string, string>): Promise<any> {
  const query = new URLSearchParams(params);
  try {
    const res = await fetch(`https://base.blockscout.com/api?${query.toString()}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status === "0" && data.message !== "No transactions found") return null;
    return data;
  } catch { return null; }
}

// Try Basescan first, fallback to Blockscout
async function explorerFetch(params: Record<string, string>): Promise<any> {
  const result = await basescanFetch(params);
  if (result) return result;
  return blockscoutFetch(params);
}

export async function fetchWalletData(address: string): Promise<WalletData> {
  const addrLower = address.toLowerCase();

  // Fire all explorer calls + token balances in parallel
  const [recentRes, firstRes, internalRes, tokenRes, tokenTxRes] = await Promise.allSettled([
    explorerFetch({ module: "account", action: "txlist", address, page: "1", offset: "100", sort: "desc" }),
    explorerFetch({ module: "account", action: "txlist", address, page: "1", offset: "1", sort: "asc" }),
    explorerFetch({ module: "account", action: "txlistinternal", address, page: "1", offset: "50", sort: "desc" }),
    fetchTokenBalances(address),
    explorerFetch({ module: "account", action: "tokentx", address, page: "1", offset: "100", sort: "desc" }),
  ]);

  const recentTxs: any[] = recentRes.status === "fulfilled" && recentRes.value?.result ? recentRes.value.result : [];
  const firstTxs: any[] = firstRes.status === "fulfilled" && firstRes.value?.result ? firstRes.value.result : [];
  const internalTxs: any[] = internalRes.status === "fulfilled" && internalRes.value?.result ? internalRes.value.result : [];

  // Get real tx count (RPC nonce = tx count sent from address)
  let totalTxCount = recentTxs.length;
  try {
    const nonce = await getTxCount(address);
    if (nonce > 0) totalTxCount = nonce;
  } catch {}

  // Timestamps
  const firstTx = firstTxs[0] ?? recentTxs[recentTxs.length - 1];
  const lastTx = recentTxs[0];
  const firstTxTimestamp = firstTx?.timeStamp ? parseInt(firstTx.timeStamp) * 1000 : null;
  const lastTxTimestamp = lastTx?.timeStamp ? parseInt(lastTx.timeStamp) * 1000 : null;

  // Contract interactions, bridges, protocols
  const contractsInteracted = new Set<string>();
  const protocols = new Set<string>();
  let bridgeCount = 0;
  const deployedContractAddresses: string[] = [];

  for (const tx of recentTxs) {
    const to = (tx.to ?? "").toLowerCase();
    if (!tx.to || tx.to === "" || tx.to === "0x") {
      if (tx.contractAddress) deployedContractAddresses.push(tx.contractAddress);
      continue;
    }
    if (to && to !== addrLower) contractsInteracted.add(to);
    if (BRIDGES[to]) { bridgeCount++; protocols.add(BRIDGES[to]); }
    if (PROTOCOLS[to]) protocols.add(PROTOCOLS[to]);
  }

  // Internal txs for additional deployment detection
  for (const tx of internalTxs) {
    if (tx.type === "create" && tx.contractAddress && tx.from?.toLowerCase() === addrLower) {
      if (!deployedContractAddresses.includes(tx.contractAddress)) {
        deployedContractAddresses.push(tx.contractAddress);
      }
    }
  }

  // Token balances from RPC
  const tokenData = tokenRes.status === "fulfilled" ? tokenRes.value : { tokens: [], ethBalance: 0, ethUsdValue: 0, totalUsd: 0 };

  // Build full token list: ETH first, then other tokens
  const tokenHoldings = [];
  if (tokenData.ethBalance > 0.00001) {
    tokenHoldings.push({
      symbol: "ETH",
      name: "Ethereum",
      contractAddress: "native",
      balance: tokenData.ethBalance,
      usdValue: tokenData.ethUsdValue,
      isSpam: false,
      chain: "base",
    });
  }
  tokenHoldings.push(...tokenData.tokens.map(t => ({ ...t, isSpam: false, chain: "base" })));

  console.log(`[baseData] ${address.slice(0, 8)} txs:${totalTxCount} deployed:${deployedContractAddresses.length} bridges:${bridgeCount} tokens:${tokenHoldings.length}`);

  return {
    address,
    totalTxCount,
    totalTransferCount: totalTxCount + ((tokenTxRes.status === "fulfilled" && tokenTxRes.value?.result) ? tokenTxRes.value.result.length : 0),
    uniqueContractsInteracted: contractsInteracted.size || Math.floor(totalTxCount * 0.3),
    baseNativeTxCount: totalTxCount,
    firstTxTimestamp,
    lastTxTimestamp,
    tokenHoldings,
    nftHoldings: [],
    totalPortfolioUsd: tokenData.totalUsd,
    spamTokenCount: 0,
    defiProtocolsUsed: Array.from(protocols),
    bridgeCount,
    contractsDeployed: deployedContractAddresses.length,
    deployedContractAddresses,
    pnlSummary: null,
    topTrades: [],
    jeets: [],
  };
}

const BRIDGES: Record<string, string> = {
  "0x3154cf16ccdb4c6d922629664174b904d80f2c35": "Base Bridge",
  "0x49048044d57e1c92a77f79988d21fa8faf74e97e": "Base Bridge",
  "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae": "LiFi Bridge",
  "0x3a23f943181408eac424116af7b7790c94cb97a5": "Socket Bridge",
  "0x9de443adc5a411e83f1878ef24c3f52c61571e72": "Stargate",
};

const PROTOCOLS: Record<string, string> = {
  "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24": "Uniswap V3",
  "0x2626664c2603336e57b271c5c0b26f421741e481": "Uniswap V3",
  "0x6ff5693b99212da76ad316178a184ab56d299b43": "Aerodrome",
  "0x420dd381b31aef6683db6b902084cb0ffece40da": "Aerodrome",
  "0x940181a94a35a4569e4529a3cdfb74e38fd98631": "Aerodrome",
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": "USDC",
  "0x4200000000000000000000000000000000000006": "WETH",
};
