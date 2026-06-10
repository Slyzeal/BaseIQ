// lib/scoring/roast.ts

import { Scores, WalletData, SocialData, Archetype, ApprovalRecord } from "../types";

interface RoastInput {
  address: string;
  scores: Scores;
  wallet: WalletData;
  social: SocialData | null;
  archetype: Archetype;
  approvals: ApprovalRecord[];
}

// ─── OpenAI Roast ─────────────────────────────────────────────────────────────
export async function generateRoast(input: RoastInput): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    return templateRoast(input);
  }

  try {
    const ageDays = input.wallet.firstTxTimestamp
      ? Math.floor((Date.now() - input.wallet.firstTxTimestamp) / 86_400_000)
      : 0;

    const suspiciousApprovals = input.approvals.filter(
      (a) => a.riskLevel === "high" || a.riskLevel === "critical"
    );

    const prompt = `You are a ruthless but funny CT (Crypto Twitter) wallet analyst. Generate a 2-3 sentence roast of this wallet. Be savage but specific — reference the actual numbers. Never be generic. No hashtags. No emojis. End with a one-line gut punch.

Wallet stats:
- Archetype: ${input.archetype}
- Wallet age: ${ageDays} days old
- Total transactions: ${input.wallet.totalTxCount}
- Base-native transactions: ${input.wallet.baseNativeTxCount}
- Portfolio value: $${input.wallet.totalPortfolioUsd.toFixed(0)}
- Reputation score: ${input.scores.reputation}/100
- Base alignment: ${input.scores.baseAlignment}/100
- Conviction score: ${input.scores.conviction}/100
- Social score: ${input.scores.social !== null ? `${input.scores.social}/100` : "no Farcaster"}
- DeFi protocols used: ${input.wallet.defiProtocolsUsed.length}
- Spam tokens received: ${input.wallet.spamTokenCount}
- Suspicious approvals: ${suspiciousApprovals.length} (${suspiciousApprovals.map((a) => a.spenderLabel).join(", ") || "none"})

Keep it under 60 words.`;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 120,
        temperature: 0.9,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) return templateRoast(input);
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    return text || templateRoast(input);
  } catch {
    return templateRoast(input);
  }
}

// ─── Template Fallback ────────────────────────────────────────────────────────
// Used when OpenAI key is absent or call fails. Still wallet-specific.
function templateRoast(input: RoastInput): string {
  const { archetype, scores, wallet, approvals } = input;
  const suspiciousApprovals = approvals.filter(
    (a) => a.riskLevel === "high" || a.riskLevel === "critical"
  );

  const ageDays = wallet.firstTxTimestamp
    ? Math.floor((Date.now() - wallet.firstTxTimestamp) / 86_400_000)
    : 0;

  // Approval-specific roast if they have sketchy approvals
  if (suspiciousApprovals.length >= 2) {
    return `You have ${suspiciousApprovals.length} high-risk approvals sitting open like unlocked car doors in a bad neighbourhood. ${suspiciousApprovals[0].spenderLabel} has unlimited access to your tokens and you clearly forgot. Your conviction score is ${scores.conviction} but your security score is zero.`;
  }

  // Archetype-specific roasts
  const roasts: Record<Archetype, string> = {
    Ghost: `${wallet.totalTxCount} transactions in ${ageDays} days. You're not a ghost, you're just bad at this. Even airdrop hunters leave more of a footprint.`,
    Tourist: `You've done ${wallet.baseNativeTxCount} Base transactions out of ${wallet.totalTxCount} total. You visit Base the same way tourists visit art museums — briefly, confused, and mostly to say you did.`,
    "Born Yesterday": `${ageDays} days old with a ${scores.reputation} reputation score. Impressive speed. Unfortunately, "impressive speed" is also how people describe falling.`,
    "Serial Rotator": `Your conviction score is ${scores.conviction}. That number is doing its best to describe someone who treats every token like a hot potato at a children's party.`,
    "Diamond-Handed Degen": `${scores.conviction}/100 conviction with ${wallet.defiProtocolsUsed.length} DeFi protocols touched. You're not diamond-handed, you just forgot your seed phrase.`,
    "Base Maxi": `${scores.baseAlignment}/100 Base alignment. Deeply impressive, or deeply concerning — the line between conviction and a no-exit strategy is thinner than your portfolio margins.`,
    "Balanced Operator": `${scores.reputation} reputation, ${scores.conviction} conviction, ${scores.baseAlignment} Base alignment. You're balanced the same way a participation trophy is balanced — technically correct, completely forgettable.`,
  };

  return roasts[archetype];
}
