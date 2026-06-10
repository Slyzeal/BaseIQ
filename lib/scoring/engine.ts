// lib/scoring/engine.ts

import { WalletData, SocialData, Scores } from "../types";

const BASE_CHAIN_ID = "0x2105"; // 8453

/**
 * Compute the four headline scores.
 * All formulas are transparent — no black-box ML.
 */
export function computeScores(
  wallet: WalletData,
  social: SocialData | null
): Scores {
  return {
    reputation: computeReputation(wallet),
    baseAlignment: computeBaseAlignment(wallet, social),
    conviction: computeConviction(wallet),
    social: social ? computeSocial(social) : null,
  };
}

// ─── Reputation (0–100) ───────────────────────────────────────────────────────
// Measures on-chain credibility: age, breadth, portfolio health
function computeReputation(w: WalletData): number {
  let score = 0;

  // Age (max 30 pts) — older wallet = more credible
  const ageMs = w.firstTxTimestamp ? Date.now() - w.firstTxTimestamp : 0;
  const ageDays = ageMs / 86_400_000;
  score += Math.min(30, (ageDays / 365) * 30);

  // Transaction volume (max 25 pts)
  score += Math.min(25, Math.log10(Math.max(1, w.totalTxCount)) * 8);

  // Contract diversity (max 20 pts)
  score += Math.min(20, Math.log10(Math.max(1, w.uniqueContractsInteracted)) * 8);

  // Portfolio value (max 15 pts)
  score += Math.min(15, Math.log10(Math.max(1, w.totalPortfolioUsd)) * 3);

  // Spam penalty (up to -10 pts)
  const spamRatio =
    w.tokenHoldings.length > 0 ? w.spamTokenCount / w.tokenHoldings.length : 0;
  score -= spamRatio * 10;

  return Math.round(Math.max(0, Math.min(100, score)));
}

// ─── Base Alignment (0–100) ───────────────────────────────────────────────────
// How "Base-native" is this wallet?
function computeBaseAlignment(
  w: WalletData,
  social: SocialData | null
): number {
  let score = 0;

  // Base tx ratio (max 40 pts)
  const baseRatio =
    w.totalTxCount > 0 ? w.baseNativeTxCount / w.totalTxCount : 0;
  score += baseRatio * 40;

  // DeFi breadth on Base (max 20 pts)
  score += Math.min(20, w.defiProtocolsUsed.length * 4);

  // Bridge activity (max 10 pts — bridging in = Base-curious)
  score += Math.min(10, w.bridgeCount * 3);

  // Farcaster / Base social (max 20 pts)
  if (social?.hasFarcaster) {
    score += 10;
    score += Math.min(10, (social.basedAppsUsed.length / 5) * 10);
  }

  // Base username (bonus 10 pts)
  if (social?.hasBaseUsername) score += 10;

  return Math.round(Math.max(0, Math.min(100, score)));
}

// ─── Conviction (0–100) ───────────────────────────────────────────────────────
// Are they holding or flipping?
function computeConviction(w: WalletData): number {
  let score = 50; // baseline

  const lastTs = w.lastTxTimestamp ?? Date.now();
  const firstTs = w.firstTxTimestamp ?? Date.now();
  const holdDays = (lastTs - firstTs) / 86_400_000;

  // Long holder bonus (max +25)
  score += Math.min(25, (holdDays / 180) * 25);

  // Low churn bonus (max +15) — fewer tx per day = less rotation
  const txPerDay = holdDays > 0 ? w.totalTxCount / holdDays : w.totalTxCount;
  if (txPerDay < 1) score += 15;
  else if (txPerDay < 3) score += 8;
  else if (txPerDay > 10) score -= 15; // serial rotator penalty

  // NFT holding depth (+10)
  if (w.nftHoldings.length >= 3) score += 10;

  return Math.round(Math.max(0, Math.min(100, score)));
}

// ─── Social (0–100) ───────────────────────────────────────────────────────────
// Farcaster/Base App presence and engagement
function computeSocial(s: SocialData): number {
  let score = 0;

  // Has Farcaster at all (30 pts base)
  if (s.hasFarcaster) score += 30;

  // Follower count (max 25 pts)
  score += Math.min(25, Math.log10(Math.max(1, s.followerCount)) * 10);

  // Cast activity (max 20 pts)
  score += Math.min(20, Math.log10(Math.max(1, s.castCount)) * 8);

  // Based apps used (max 15 pts)
  score += Math.min(15, s.basedAppsUsed.length * 3);

  // Base username (10 pts)
  if (s.hasBaseUsername) score += 10;

  return Math.round(Math.max(0, Math.min(100, score)));
}

/** Estimate rarity percentile (0–100, lower = rarer) based on reputation */
export function computeRarityPercentile(scores: Scores): number {
  const avg =
    (scores.reputation +
      scores.baseAlignment +
      scores.conviction +
      (scores.social ?? 50)) /
    4;
  // Map avg score to approximate top-X% framing
  if (avg >= 85) return 2;
  if (avg >= 75) return 8;
  if (avg >= 65) return 18;
  if (avg >= 55) return 35;
  if (avg >= 45) return 55;
  if (avg >= 35) return 72;
  return 88;
}
