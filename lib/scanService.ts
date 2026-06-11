// lib/scanService.ts
// Circuit breaker orchestrator.
// Failover: fresh cache → Moralis → Alchemy → public RPC → stale cache → error

import { ScanResult, WalletData, SocialData } from "./types";
import { cache } from "./cache";
import * as moralis from "./adapters/moralis";
import * as alchemy from "./adapters/alchemy";
import * as publicRpc from "./adapters/publicRpc";
import { fetchSocialData } from "./adapters/neynar";
import { parseApprovals, summarizeApprovals } from "./approvals/scanner";
import { computeScores, computeRarityPercentile } from "./scoring/engine";
import { classifyArchetype } from "./scoring/archetype";
import { generateVerdictTags } from "./scoring/verdict";
import { generateRoast } from "./scoring/roast";

export async function scanWallet(address: string, forceRefresh = false): Promise<ScanResult> {
  const cacheKey = `scan:${address.toLowerCase()}`;

  // 1. Fresh cache hit — skip if forceRefresh or if cached result has 0 txs (bad cache)
  if (!forceRefresh) {
    const cached = await cache.get<ScanResult>(cacheKey);
    if (cached && cached.scores.reputation > 0) return { ...cached, dataSource: "cache" };
  }

  let walletData: WalletData | null = null;
  let dataSource: ScanResult["dataSource"] = "moralis";

  // 2. Moralis (primary)
  try {
    walletData = await moralis.fetchWalletData(address);
    dataSource = "moralis";
  } catch (e: any) {
    if (e.message !== "MORALIS_EXHAUSTED") throw e;
  }

  // 3. Alchemy (alternate)
  if (!walletData && process.env.ALCHEMY_API_KEY) {
    try {
      const d = await alchemy.fetchWalletData(address);
      walletData = { ...d, contractsDeployed: 0, deployedContractAddresses: [], pnlSummary: null, topTrades: [], jeets: [] };
      dataSource = "alchemy";
    } catch {}
  }

  // 4. Public RPC (degraded)
  if (!walletData) {
    try {
      const d = await publicRpc.fetchWalletData(address);
      walletData = { ...d, contractsDeployed: 0, deployedContractAddresses: [], pnlSummary: null, topTrades: [], jeets: [] };
      dataSource = "publicRpc";
    } catch {}
  }

  // 5. Stale cache fallback
  if (!walletData) {
    const stale = await cache.getStale<ScanResult>(cacheKey);
    if (stale) return { ...stale, dataSource: "cache" };
    throw new Error("All data sources exhausted — try again later.");
  }

  // Social (non-blocking)
  let socialData: SocialData | null = null;
  try { socialData = await fetchSocialData(address); } catch {}

  // Approvals (non-blocking)
  let approvals: import("./types").ApprovalRecord[] = [];
  try {
    const raw = await moralis.fetchApprovals(address);
    approvals = parseApprovals(raw);
  } catch {}

  const scores = computeScores(walletData, socialData);
  const { archetype, emoji } = classifyArchetype(scores, walletData);
  const verdictTags = generateVerdictTags(scores, walletData, socialData, approvals);
  const rarityPercentile = computeRarityPercentile(scores);
  const roast = await generateRoast({ address, scores, wallet: walletData, social: socialData, archetype, approvals });
  const summary = buildSummary(walletData, scores, archetype, socialData);

  const result: ScanResult = {
    address,
    scores,
    archetype,
    archetypeEmoji: emoji,
    verdictTags,
    summary,
    roast,
    approvals,
    approvalRiskSummary: summarizeApprovals(approvals),
    socialData,
    rarityPercentile,
    scannedAt: Date.now(),
    dataSource,
    pnlSummary: walletData.pnlSummary,
    topTrades: walletData.topTrades,
    jeets: walletData.jeets,
    contractsDeployed: walletData.contractsDeployed,
    deployedContractAddresses: walletData.deployedContractAddresses,
  };

  // Only cache if we got real data — never cache empty/ghost results for active wallets
  if (walletData.totalTxCount > 0 || walletData.tokenHoldings.length > 0) {
    await cache.set(cacheKey, result);
  }
  return result;
}

function buildSummary(wallet: WalletData, scores: ReturnType<typeof computeScores>, archetype: string, social: SocialData | null): string {
  const ageDays = wallet.firstTxTimestamp
    ? Math.floor((Date.now() - wallet.firstTxTimestamp) / 86_400_000) : 0;

  const nonSpamTokens = wallet.tokenHoldings.filter(t => !t.isSpam);
  const portfolioStr = wallet.totalPortfolioUsd > 0
    ? `~$${wallet.totalPortfolioUsd.toFixed(0)} USD`
    : `${nonSpamTokens.length} token${nonSpamTokens.length !== 1 ? "s" : ""}`;

  const parts = [
    `${ageDays > 0 ? `${ageDays}-day-old` : "New"} wallet.`,
    `${wallet.totalTxCount.toLocaleString()} transactions on Base.`,
    social?.hasFarcaster
      ? `Farcaster: @${social.farcasterUsername} (${social.followerCount.toLocaleString()} followers).`
      : "No Farcaster identity found.",
    `Portfolio: ${portfolioStr}.`,
    wallet.contractsDeployed > 0 ? `Deployed ${wallet.contractsDeployed} contract${wallet.contractsDeployed !== 1 ? "s" : ""} on Base.` : "",
    `Classified as: ${archetype}.`,
  ].filter(Boolean);

  return parts.join(" ");
}
