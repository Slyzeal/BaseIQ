// lib/scanService.ts
// Full tier orchestration:
// TIER 1: baseData (free) + jeetEngine (free) + Moralis PnL (optional)
// TIER 2: baseData + jeetEngine, no PnL (Moralis exhausted)
// TIER 3: publicRpc only (all keyed sources down)
// TIER 4: stale cache

import { ScanResult, WalletData, SocialData } from "./types";
import { cache } from "./cache";
import * as baseData from "./adapters/baseData";
import * as moralis from "./adapters/moralis";
import * as publicRpc from "./adapters/publicRpc";
import { detectJeets } from "./jeetEngine";
import { fetchSocialData } from "./adapters/neynar";
import { parseApprovals, summarizeApprovals } from "./approvals/scanner";
import { computeScores, computeRarityPercentile } from "./scoring/engine";
import { classifyArchetype } from "./scoring/archetype";
import { generateVerdictTags } from "./scoring/verdict";
import { generateRoast } from "./scoring/roast";

export async function scanWallet(address: string, forceRefresh = false): Promise<ScanResult> {
  const cacheKey = `scan:${address.toLowerCase()}`;
  const start = Date.now();

  // 1. Cache check
  if (!forceRefresh) {
    const cached = await cache.get<ScanResult>(cacheKey);
    if (cached && cached.scores.reputation > 0 && !cached.summary.includes("0 transactions")) {
      console.log(`[scan] ${address.slice(0, 8)} tier:cache ms:${Date.now() - start}`);
      return { ...cached, dataSource: "cache" };
    }
  }

  let walletData: WalletData | null = null;
  let dataSource: ScanResult["dataSource"] = "basescan";
  let degraded: ScanResult["degraded"] = null;

  // 2. TIER 1/2: baseData (Basescan + RPC — always free)
  try {
    walletData = await baseData.fetchWalletData(address);
    dataSource = "basescan";
  } catch (e) {
    console.error("[scan] baseData failed:", e);
  }

  // 3. TIER 3: public RPC fallback
  if (!walletData) {
    try {
      const d = await publicRpc.fetchWalletData(address);
      walletData = { ...d, contractsDeployed: 0, deployedContractAddresses: [], pnlSummary: null, topTrades: [], jeets: [] };
      dataSource = "rpc";
      degraded = "basic";
    } catch {}
  }

  // 4. TIER 4: stale cache
  if (!walletData) {
    const stale = await cache.getStale<ScanResult>(cacheKey);
    if (stale) {
      console.log(`[scan] ${address.slice(0, 8)} tier:stale ms:${Date.now() - start}`);
      return { ...stale, dataSource: "cache" };
    }
    throw new Error("All data sources exhausted — try again later.");
  }

  // 5. Jeet detection (free — Basescan tokentx + GeckoTerminal + DexScreener)
  // Run in parallel with PnL attempt
  const [jeets, pnlResult, socialData, approvalsRaw] = await Promise.allSettled([
    degraded !== "basic" ? detectJeets(address) : Promise.resolve([]),
    tryMoralisPnL(address),
    fetchSocialData(address).catch(() => null),
    moralis.fetchApprovals(address).catch(() => []),
  ]);

  // Merge jeets
  walletData.jeets = jeets.status === "fulfilled" ? jeets.value : [];

  // Merge PnL if available
  if (pnlResult.status === "fulfilled" && pnlResult.value) {
    walletData.pnlSummary = pnlResult.value.pnlSummary;
    walletData.topTrades = pnlResult.value.topTrades;
    dataSource = "moralis";
  } else {
    degraded = degraded ?? "no-pnl";
  }

  const social: SocialData | null = socialData.status === "fulfilled" ? socialData.value : null;
  const approvals = approvalsRaw.status === "fulfilled"
    ? parseApprovals(approvalsRaw.value)
    : [];

  const scores = computeScores(walletData, social);
  const { archetype, emoji } = classifyArchetype(scores, walletData);
  const verdictTags = generateVerdictTags(scores, walletData, social, approvals);
  const rarityPercentile = computeRarityPercentile(scores);
  const roast = await generateRoast({ address, scores, wallet: walletData, social, archetype, approvals });
  const summary = buildSummary(walletData, archetype, social);

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
    socialData: social,
    rarityPercentile,
    scannedAt: Date.now(),
    dataSource,
    degraded,
    pnlSummary: walletData.pnlSummary,
    topTrades: walletData.topTrades,
    jeets: walletData.jeets,
    contractsDeployed: walletData.contractsDeployed,
    deployedContractAddresses: walletData.deployedContractAddresses,
    totalTxCount: walletData.totalTxCount,
    totalTransferCount: walletData.totalTransferCount,
  };

  console.log(`[scan] ${address.slice(0, 8)} tier:${degraded ?? "full"} src:${dataSource} jeets:${walletData.jeets.length} ms:${Date.now() - start}`);

  // Cache only real results
  const hasRealData = walletData.totalTxCount > 5 || walletData.contractsDeployed > 0 || walletData.totalPortfolioUsd > 10;
  if (hasRealData) await cache.set(cacheKey, result);

  return result;
}

async function tryMoralisPnL(address: string): Promise<{ pnlSummary: any; topTrades: any[] } | null> {
  try {
    const data = await moralis.fetchPnL(address);
    return data;
  } catch (e: any) {
    if (e.message === "MORALIS_EXHAUSTED") return null;
    return null;
  }
}

function buildSummary(wallet: WalletData, archetype: string, social: SocialData | null): string {
  const ageDays = wallet.firstTxTimestamp
    ? Math.floor((Date.now() - wallet.firstTxTimestamp) / 86_400_000) : 0;
  const nonSpamTokens = wallet.tokenHoldings.filter(t => !t.isSpam);
  const portfolioStr = wallet.totalPortfolioUsd > 0
    ? `~$${wallet.totalPortfolioUsd.toFixed(0)} USD`
    : `${nonSpamTokens.length} token${nonSpamTokens.length !== 1 ? "s" : ""}`;

  return [
    `${ageDays > 0 ? `${ageDays}-day-old` : "New"} wallet.`,
    `${wallet.totalTxCount.toLocaleString()} transactions on Base.`,
    social?.hasFarcaster
      ? `Farcaster: @${social.farcasterUsername} (${social.followerCount.toLocaleString()} followers).`
      : "No Farcaster identity found.",
    `Portfolio: ${portfolioStr}.`,
    wallet.contractsDeployed > 0 ? `Deployed ${wallet.contractsDeployed} contract${wallet.contractsDeployed !== 1 ? "s" : ""} on Base.` : "",
    `Classified as: ${archetype}.`,
  ].filter(Boolean).join(" ");
}
