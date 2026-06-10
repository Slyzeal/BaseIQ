// lib/scanService.ts
// Circuit breaker orchestrator.
// Failover chain: fresh cache → Moralis → Alchemy → public RPC → stale cache → error
// All data sources degrade gracefully — never throws to the caller.

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

export async function scanWallet(address: string): Promise<ScanResult> {
  const cacheKey = `scan:${address.toLowerCase()}`;

  // 1. Fresh cache hit
  const cached = cache.get<ScanResult>(cacheKey);
  if (cached) return { ...cached, dataSource: "cache" };

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
      walletData = await alchemy.fetchWalletData(address);
      dataSource = "alchemy";
    } catch {}
  }

  // 4. Public RPC (keyless degraded)
  if (!walletData) {
    try {
      walletData = await publicRpc.fetchWalletData(address);
      dataSource = "publicRpc";
    } catch {}
  }

  // 5. Stale cache fallback
  if (!walletData) {
    const stale = cache.getStale<ScanResult>(cacheKey);
    if (stale) return { ...stale, dataSource: "cache" };
    throw new Error("All data sources exhausted — try again later.");
  }

  // Fetch social data (non-blocking — failure returns null)
  let socialData: SocialData | null = null;
  try {
    socialData = await fetchSocialData(address);
  } catch {}

  // Fetch approvals (non-blocking)
  let approvals = [];
  try {
    const raw = await moralis.fetchApprovals(address);
    approvals = parseApprovals(raw);
  } catch {}

  // Score + classify
  const scores = computeScores(walletData, socialData);
  const { archetype, emoji } = classifyArchetype(scores, walletData);
  const verdictTags = generateVerdictTags(scores, walletData, socialData, approvals);
  const rarityPercentile = computeRarityPercentile(scores);

  // Generate roast + summary (with OpenAI or template fallback)
  const roast = await generateRoast({
    address,
    scores,
    wallet: walletData,
    social: socialData,
    archetype,
    approvals,
  });

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
  };

  cache.set(cacheKey, result);
  return result;
}

function buildSummary(
  wallet: WalletData,
  scores: ReturnType<typeof computeScores>,
  archetype: string,
  social: SocialData | null
): string {
  const ageDays = wallet.firstTxTimestamp
    ? Math.floor((Date.now() - wallet.firstTxTimestamp) / 86_400_000)
    : 0;

  const parts: string[] = [
    `${ageDays > 0 ? `${ageDays}-day-old` : "New"} wallet.`,
    `${wallet.totalTxCount} total transactions, ${wallet.baseNativeTxCount} on Base.`,
    social?.hasFarcaster
      ? `Farcaster: @${social.farcasterUsername} (${social.followerCount} followers).`
      : "No Farcaster identity found.",
    `Portfolio: ~$${wallet.totalPortfolioUsd.toFixed(0)} USD across ${wallet.tokenHoldings.length} tokens.`,
    `Classified as: ${archetype}.`,
  ];

  return parts.join(" ");
}
