// lib/adapters/alchemy.ts
// Alternate data adapter — Alchemy (30M CU/month free tier).
// Used as fallback if Moralis is fully exhausted.
// NOTE: Alchemy free tier has limited CU — use sparingly.

import { WalletData, TokenHolding, NftHolding } from "../types";

const BASE_CHAIN_ID = 8453;

function getAlchemyUrl(): string {
  const key = process.env.ALCHEMY_API_KEY;
  if (!key) throw new Error("ALCHEMY_KEY_MISSING");
  return `https://base-mainnet.g.alchemy.com/v2/${key}`;
}

async function alchemyRpc(method: string, params: unknown[]): Promise<any> {
  const res = await fetch(getAlchemyUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Alchemy RPC error: ${data.error.message}`);
  return data.result;
}

export async function fetchWalletData(address: string): Promise<WalletData> {
  const [tokensResult, txCountResult] = await Promise.allSettled([
    alchemyRpc("alchemy_getTokenBalances", [address]),
    alchemyRpc("eth_getTransactionCount", [address, "latest"]),
  ]);

  const tokens: TokenHolding[] = [];

  if (tokensResult.status === "fulfilled") {
    for (const t of tokensResult.value?.tokenBalances ?? []) {
      if (t.tokenBalance === "0x0000000000000000000000000000000000000000000000000000000000000000") continue;
      tokens.push({
        symbol: "?",
        name: "Unknown",
        contractAddress: t.contractAddress,
        balance: parseInt(t.tokenBalance, 16),
        usdValue: 0, // Alchemy free tier doesn't include USD values
        isSpam: false,
        chain: "base",
      });
    }
  }

  const txCount =
    txCountResult.status === "fulfilled"
      ? parseInt(txCountResult.value ?? "0x0", 16)
      : 0;

  return {
    address,
    totalTxCount: txCount,
    totalTransferCount: txCount,
    uniqueContractsInteracted: 0,
    baseNativeTxCount: txCount,
    firstTxTimestamp: null,
    lastTxTimestamp: null,
    tokenHoldings: tokens,
    nftHoldings: [],
    totalPortfolioUsd: 0,
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
