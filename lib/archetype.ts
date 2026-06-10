// lib/scoring/archetype.ts

import { Scores, Archetype, WalletData } from "../types";

interface ArchetypeResult {
  archetype: Archetype;
  emoji: string;
}

/**
 * Classify a wallet into one of 7 archetypes based on scores + raw wallet data.
 * Rules are deterministic and explainable — no hidden weighting.
 */
export function classifyArchetype(
  scores: Scores,
  wallet: WalletData
): ArchetypeResult {
  const { reputation, baseAlignment, conviction } = scores;

  const ageDays = wallet.firstTxTimestamp
    ? (Date.now() - wallet.firstTxTimestamp) / 86_400_000
    : 0;

  const txPerDay =
    ageDays > 0 ? wallet.totalTxCount / ageDays : wallet.totalTxCount;

  // Ghost — barely active, low reputation
  if (wallet.totalTxCount < 10 && reputation < 25) {
    return { archetype: "Ghost", emoji: "👻" };
  }

  // Born Yesterday — very new wallet
  if (ageDays < 30 && wallet.totalTxCount < 20) {
    return { archetype: "Born Yesterday", emoji: "🐣" };
  }

  // Tourist — active but barely Base-aligned
  if (baseAlignment < 25 && wallet.totalTxCount > 20) {
    return { archetype: "Tourist", emoji: "🧳" };
  }

  // Serial Rotator — high tx volume, low conviction
  if (txPerDay > 8 && conviction < 40) {
    return { archetype: "Serial Rotator", emoji: "🌀" };
  }

  // Base Maxi — extremely Base-aligned, social presence
  if (baseAlignment >= 75 && (scores.social ?? 0) >= 50) {
    return { archetype: "Base Maxi", emoji: "🔵" };
  }

  // Diamond-Handed Degen — high conviction, active degen
  if (conviction >= 70 && wallet.defiProtocolsUsed.length >= 3) {
    return { archetype: "Diamond-Handed Degen", emoji: "💎" };
  }

  // Default: Balanced Operator
  return { archetype: "Balanced Operator", emoji: "⚖️" };
}
