// lib/adapters/publicRpc.ts
// Keyless degraded fallback — uses public Base RPC.
// Returns minimal data (tx count + ETH balance only).
// Active only when all keyed adapters are exhausted.

import { WalletData } from "../types";

const PUBLIC_RPC = "https://mainnet.base.org";

async function rpc(method: string, params: unknown[]): Promise<any> {
  const res = await fetch(PUBLIC_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = await res.json();
  return data.result;
}

export async function fetchWalletData(address: string): Promise<WalletData> {
  const [txCountRaw, balanceRaw] = await Promise.allSettled([
    rpc("eth_getTransactionCount", [address, "latest"]),
    rpc("eth_getBalance", [address, "latest"]),
  ]);

  const txCount =
    txCountRaw.status === "fulfilled"
      ? parseInt(txCountRaw.value ?? "0x0", 16)
      : 0;

  const ethBalance =
    balanceRaw.status === "fulfilled"
      ? parseInt(balanceRaw.value ?? "0x0", 16) / 1e18
      : 0;

  return {
    address,
    totalTxCount: txCount,
    uniqueContractsInteracted: 0,
    baseNativeTxCount: txCount,
    firstTxTimestamp: null,
    lastTxTimestamp: null,
    tokenHoldings: [],
    nftHoldings: [],
    totalPortfolioUsd: ethBalance * 3000,
    spamTokenCount: 0,
    defiProtocolsUsed: [],
    bridgeCount: 0,
    pnlSummary: null,
    topTrades: [],
    contractsDeployed: 0,
    deployedContractAddresses: [],
    jeets: [],
  };
}
