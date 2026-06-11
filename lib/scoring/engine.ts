// lib/scoring/engine.ts

import { WalletData, SocialData, Scores } from "../types";

export function computeScores(wallet: WalletData, social: SocialData | null): Scores {
  return {
    reputation: computeReputation(wallet),
    baseAlignment: computeBaseAlignment(wallet, social),
    conviction: computeConviction(wallet),
    social: social ? computeSocial(social) : null,
  };
}

// ── Reputation (0–100) ────────────────────────────────────────────────────────
function computeReputation(w: WalletData): number {
  let score = 0;

  // Age (max 25pts)
  const ageDays = w.firstTxTimestamp ? (Date.now() - w.firstTxTimestamp) / 86_400_000 : 0;
  score += Math.min(25, (ageDays / 365) * 25);

  // Tx volume (max 20pts) — log scale
  score += Math.min(20, Math.log10(Math.max(1, w.totalTxCount)) * 6);

  // Unique contracts (max 15pts)
  score += Math.min(15, Math.log10(Math.max(1, w.uniqueContractsInteracted)) * 6);

  // Portfolio value (max 15pts) — use token count as fallback
  if (w.totalPortfolioUsd > 0) {
    score += Math.min(15, Math.log10(Math.max(1, w.totalPortfolioUsd)) * 3);
  } else {
    score += Math.min(8, w.tokenHoldings.filter(t => !t.isSpam).length * 1.5);
  }

  // Contracts deployed (max 15pts) — builder signal
  const deployed = w.contractsDeployed ?? 0;
  if (deployed > 0) {
    score += Math.min(15, 5 + deployed * 3);
  }

  // PnL track record (max 10pts)
  if (w.pnlSummary && w.pnlSummary.totalTradeCount > 0) {
    score += Math.min(5, Math.log10(w.pnlSummary.totalTradeCount) * 3);
    if (w.pnlSummary.totalRealizedProfitUsd > 0) score += 5;
  }

  // Spam penalty (up to -10pts)
  const spamRatio = w.tokenHoldings.length > 0 ? w.spamTokenCount / w.tokenHoldings.length : 0;
  score -= spamRatio * 10;

  return Math.round(Math.max(0, Math.min(100, score)));
}

// ── Base Alignment (0–100) ────────────────────────────────────────────────────
function computeBaseAlignment(w: WalletData, social: SocialData | null): number {
  let score = 0;

  // Base tx ratio (max 35pts)
  const baseRatio = w.totalTxCount > 0 ? Math.min(1, w.baseNativeTxCount / w.totalTxCount) : 0;
  score += baseRatio * 35;

  // DeFi protocol breadth (max 20pts)
  const knownProtocols = w.defiProtocolsUsed.filter(p =>
    ["Uniswap", "Aerodrome", "Base Bridge", "LiFi", "Socket"].some(k => p.includes(k))
  ).length;
  score += Math.min(20, knownProtocols * 5 + Math.floor(w.uniqueContractsInteracted / 10));

  // Contracts deployed on Base (max 20pts) — strongest builder signal
  const deployed = w.contractsDeployed ?? 0;
  if (deployed > 0) {
    score += Math.min(20, 8 + deployed * 4);
  }

  // Bridge activity (max 8pts)
  score += Math.min(8, w.bridgeCount * 2);

  // Farcaster / Base social (max 12pts)
  if (social?.hasFarcaster) {
    score += 6;
    score += Math.min(4, social.basedAppsUsed.length * 2);
  }
  if (social?.hasBaseUsername) score += 5;

  return Math.round(Math.max(0, Math.min(100, score)));
}

// ── Conviction (0–100) ────────────────────────────────────────────────────────
// Measures Base-specific commitment — NOT passive holding
function computeConviction(w: WalletData): number {
  let score = 30; // lower baseline

  const ageDays = w.firstTxTimestamp ? (Date.now() - w.firstTxTimestamp) / 86_400_000 : 0;
  const lastActiveDays = w.lastTxTimestamp ? (Date.now() - w.lastTxTimestamp) / 86_400_000 : 999;

  // Base activity recency (max 20pts) — were they active in last 30/60/90 days?
  if (lastActiveDays < 30) score += 20;
  else if (lastActiveDays < 60) score += 12;
  else if (lastActiveDays < 90) score += 6;
  else score -= 10; // inactive penalty

  // Sustained activity over time (max 20pts)
  // High conviction = consistent Base usage, not one-time burst
  if (ageDays > 0) {
    const txPerMonth = (w.baseNativeTxCount / ageDays) * 30;
    if (txPerMonth >= 10 && txPerMonth <= 200) score += 20; // consistent
    else if (txPerMonth >= 3) score += 10; // moderate
    else if (txPerMonth < 1) score -= 15; // tourist level
  }

  // Protocol loyalty (max 15pts) — returning to same protocols = conviction
  const knownProtocols = w.defiProtocolsUsed.filter(p =>
    ["Uniswap", "Aerodrome", "Base Bridge"].some(k => p.includes(k))
  ).length;
  score += Math.min(15, knownProtocols * 5);

  // Wallet age on Base (max 10pts)
  score += Math.min(10, (ageDays / 180) * 10);

  // Base-native token holding (max 5pts)
  const hasBaseTokens = w.tokenHoldings.some(t =>
    !t.isSpam && t.balance > 0 && t.contractAddress !== "native"
  );
  if (hasBaseTokens) score += 5;

  // Contracts deployed = ultimate conviction signal (+10pts)
  if ((w.contractsDeployed ?? 0) > 0) score += 10;

  // Jeet penalty — selling everything early = low conviction
  const jeetCount = w.topTrades?.filter(t => !t.isWin && Math.abs(t.roiPct) > 50).length ?? 0;
  score -= jeetCount * 5;

  return Math.round(Math.max(0, Math.min(100, score)));
}

// ── Social (0–100) ────────────────────────────────────────────────────────────
function computeSocial(s: SocialData): number {
  let score = 0;
  if (s.hasFarcaster) score += 30;
  score += Math.min(25, Math.log10(Math.max(1, s.followerCount)) * 10);
  score += Math.min(20, Math.log10(Math.max(1, s.castCount)) * 8);
  score += Math.min(15, s.basedAppsUsed.length * 3);
  if (s.hasBaseUsername) score += 10;
  return Math.round(Math.max(0, Math.min(100, score)));
}

export function computeRarityPercentile(scores: Scores): number {
  const avg = (scores.reputation + scores.baseAlignment + scores.conviction + (scores.social ?? 50)) / 4;
  if (avg >= 85) return 2;
  if (avg >= 75) return 8;
  if (avg >= 65) return 18;
  if (avg >= 55) return 35;
  if (avg >= 45) return 55;
  if (avg >= 35) return 72;
  return 88;
}
