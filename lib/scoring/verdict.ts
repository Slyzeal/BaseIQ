// lib/scoring/verdict.ts

import { Scores, WalletData, SocialData, ApprovalRecord } from "../types";

/**
 * Generate 3–6 short CT-style verdict tags for a wallet.
 * Tags are additive — a wallet can earn multiple.
 */
export function generateVerdictTags(
  scores: Scores,
  wallet: WalletData,
  social: SocialData | null,
  approvals: ApprovalRecord[]
): string[] {
  const tags: string[] = [];

  // ── Reputation tags ──────────────────────────────────────────────────────
  if (scores.reputation >= 80) tags.push("OG Wallet");
  else if (scores.reputation >= 60) tags.push("Established");
  else if (scores.reputation < 25) tags.push("Anon Rookie");

  // ── Base Alignment tags ──────────────────────────────────────────────────
  if (scores.baseAlignment >= 80) tags.push("Base Native");
  else if (scores.baseAlignment >= 55) tags.push("Base Curious");
  else if (scores.baseAlignment < 20) tags.push("Chain Tourist");

  // ── Conviction tags ──────────────────────────────────────────────────────
  if (scores.conviction >= 75) tags.push("Diamond Hands");
  else if (scores.conviction < 30) tags.push("Paper Hands");

  // ── Activity tags ────────────────────────────────────────────────────────
  const ageDays = wallet.firstTxTimestamp
    ? (Date.now() - wallet.firstTxTimestamp) / 86_400_000
    : 0;
  const txPerDay = ageDays > 0 ? wallet.totalTxCount / ageDays : 0;

  if (txPerDay > 10) tags.push("Degen Energy");
  if (wallet.defiProtocolsUsed.length >= 5) tags.push("DeFi Power User");
  if (wallet.bridgeCount >= 5) tags.push("Bridge Hopper");

  // ── Social tags ──────────────────────────────────────────────────────────
  if (social?.hasFarcaster && (social.followerCount ?? 0) > 1000)
    tags.push("CT Influencer");
  else if (social?.hasFarcaster) tags.push("Farcaster Verified");
  if (social?.hasBaseUsername) tags.push("Based Username");

  // ── Approval hygiene tags ────────────────────────────────────────────────
  const criticalApprovals = approvals.filter((a) => a.riskLevel === "critical");
  const highApprovals = approvals.filter((a) => a.riskLevel === "high");

  if (criticalApprovals.length > 0) tags.push("⚠️ Critical Approvals");
  else if (highApprovals.length >= 3) tags.push("Approval Risk");
  else if (approvals.length === 0) tags.push("Clean Approvals");

  // ── Spam tag ─────────────────────────────────────────────────────────────
  if (wallet.spamTokenCount > 5) tags.push("Spam Magnet");

  return tags.slice(0, 6);
}
