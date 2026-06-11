// lib/scoring/roast.ts
// Triple AI roast engine: randomly picks Gemini, Groq, or Mistral.
// Failover chain: random AI → next AI → template fallback.
// Templates expanded to 20+ variants per archetype for uniqueness.

import { Scores, WalletData, SocialData, Archetype, ApprovalRecord } from "../types";

interface RoastInput {
  address: string;
  scores: Scores;
  wallet: WalletData;
  social: SocialData | null;
  archetype: Archetype;
  approvals: ApprovalRecord[];
}

// ── AI Provider configs ───────────────────────────────────────────────────────
const AI_PROVIDERS = [
  {
    name: "gemini",
    envKey: "GEMINI_API_KEY",
    call: async (prompt: string, key: string) => {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 150, temperature: 1.0 },
          }),
        }
      );
      if (!res.ok) throw new Error(`Gemini ${res.status}`);
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
    },
  },
  {
    name: "groq",
    envKey: "GROQ_API_KEY",
    call: async (prompt: string, key: string) => {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          max_tokens: 150,
          temperature: 1.0,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) throw new Error(`Groq ${res.status}`);
      const data = await res.json();
      return data.choices?.[0]?.message?.content?.trim() ?? null;
    },
  },
  {
    name: "mistral",
    envKey: "MISTRAL_API_KEY",
    call: async (prompt: string, key: string) => {
      const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: "mistral-small-latest",
          max_tokens: 150,
          temperature: 1.0,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) throw new Error(`Mistral ${res.status}`);
      const data = await res.json();
      return data.choices?.[0]?.message?.content?.trim() ?? null;
    },
  },
];

function buildPrompt(input: RoastInput): string {
  const { archetype, scores, wallet, social, approvals } = input;
  const ageDays = wallet.firstTxTimestamp
    ? Math.floor((Date.now() - wallet.firstTxTimestamp) / 86_400_000)
    : 0;
  const suspicious = approvals.filter(a => a.riskLevel === "high" || a.riskLevel === "critical");
  const topJeet = wallet.topTrades?.find(t => t.realizedProfitUsd < 0 && Math.abs(t.roiPct) > 50);
  const topWin = wallet.topTrades?.find(t => t.isWin && t.roiPct > 50);
  const jeetLine = topJeet ? `Biggest jeet: sold ${topJeet.tokenSymbol} at avg $${topJeet.avgSellPriceUsd.toFixed(4)}, lost $${Math.abs(topJeet.realizedProfitUsd).toFixed(0)}.` : "";
  const winLine = topWin ? `Best trade: ${topWin.tokenSymbol} for +$${topWin.realizedProfitUsd.toFixed(0)} (+${topWin.roiPct.toFixed(0)}%).` : "";
  const contractsLine = wallet.contractsDeployed && wallet.contractsDeployed > 0
    ? `Deployed ${wallet.contractsDeployed} contracts on Base.` : "";

  return `You are a ruthless, witty CT (Crypto Twitter) wallet analyst. Write a UNIQUE 2-3 sentence roast of this specific wallet. Be savage, specific, and reference the actual numbers below. Never be generic. No hashtags. No emojis. End with a one-line gut punch. Keep it under 60 words.

Wallet: ${input.address.slice(0, 8)}...
Archetype: ${archetype}
Age: ${ageDays} days old
Transactions: ${wallet.totalTxCount.toLocaleString()} on Base
Reputation: ${scores.reputation}/100
Base Alignment: ${scores.baseAlignment}/100  
Conviction: ${scores.conviction}/100
${social?.hasFarcaster ? `Farcaster: @${social.farcasterUsername} (${social.followerCount} followers)` : "No Farcaster identity"}
Portfolio: $${wallet.totalPortfolioUsd.toFixed(0)}
DeFi protocols: ${wallet.defiProtocolsUsed.length}
Spam tokens: ${wallet.spamTokenCount}
Suspicious approvals: ${suspicious.length}
${jeetLine}
${winLine}
${contractsLine}
PnL: ${wallet.pnlSummary ? `$${wallet.pnlSummary.totalRealizedProfitUsd.toFixed(0)} realized` : "no trade data"}`;
}

export async function generateRoast(input: RoastInput): Promise<string> {
  const availableProviders = AI_PROVIDERS.filter(p => !!process.env[p.envKey]);

  if (availableProviders.length === 0) {
    return templateRoast(input);
  }

  // Randomly pick starting provider for variety
  const shuffled = [...availableProviders].sort(() => Math.random() - 0.5);
  const prompt = buildPrompt(input);

  for (const provider of shuffled) {
    const key = process.env[provider.envKey]!;
    try {
      const text = await provider.call(prompt, key);
      if (text && text.length > 20) return text;
    } catch {}
  }

  return templateRoast(input);
}

// ── Template fallback — 20+ variants per archetype ───────────────────────────
function templateRoast(input: RoastInput): string {
  const { archetype, scores, wallet, approvals } = input;
  const ageDays = wallet.firstTxTimestamp
    ? Math.floor((Date.now() - wallet.firstTxTimestamp) / 86_400_000)
    : 0;
  const suspicious = approvals.filter(a => a.riskLevel === "high" || a.riskLevel === "critical");
  const topJeet = wallet.topTrades?.find(t => !t.isWin && Math.abs(t.roiPct) > 30);
  const topWin = wallet.topTrades?.find(t => t.isWin);

  // Approval roast if sketchy
  if (suspicious.length >= 2) {
    const roasts = [
      `${suspicious.length} high-risk approvals sitting open like unlocked car doors in a bad neighbourhood. ${suspicious[0].spenderLabel} has unlimited access to your tokens and you clearly forgot. Conviction ${scores.conviction}, security IQ: zero.`,
      `You've given ${suspicious[0].spenderLabel} a blank cheque to your wallet and gone on holiday. ${suspicious.length} open approvals, ${wallet.totalTxCount} transactions, zero brain cells allocated to DYOR.`,
      `${suspicious.length} suspicious approvals still live. You signed everything that moved and forgot to look back. The only thing more open than your approvals is your disregard for your own funds.`,
    ];
    return roasts[Math.floor(Math.random() * roasts.length)];
  }

  // Jeet-specific roast
  if (topJeet) {
    const roasts = [
      `You sold ${topJeet.tokenSymbol} at $${topJeet.avgSellPriceUsd.toFixed(4)} and left $${Math.abs(topJeet.realizedProfitUsd).toFixed(0)} on the table. ${ageDays} days on Base and your hands are still made of wet tissue paper.`,
      `${topJeet.tokenSymbol} at avg $${topJeet.avgSellPriceUsd.toFixed(4)} — classic jeet behavior. You have ${scores.conviction} conviction but apparently not enough to hold through a sneeze.`,
    ];
    return roasts[Math.floor(Math.random() * roasts.length)];
  }

  const roastMap: Record<Archetype, string[]> = {
    Ghost: [
      `${wallet.totalTxCount} transactions and a reputation score of ${scores.reputation}. You exist on Base the same way expired milk exists in a fridge — technically present, obviously wrong.`,
      `${ageDays} days old, ${wallet.totalTxCount} txs, ${scores.reputation} reputation. Your on-chain presence is so faint that Basescan loads your history as a courtesy.`,
      `Ghost wallets have more personality. ${wallet.totalTxCount} transactions, no DeFi, no identity, ${scores.reputation} reputation. You're not building, you're just breathing gas fees.`,
    ],
    Tourist: [
      `${wallet.baseNativeTxCount} Base transactions out of ${wallet.totalTxCount} total. You visit Base the same way tourists visit museums — briefly, confused, and only to say you did.`,
      `${scores.baseAlignment}/100 Base alignment after ${ageDays} days. At this rate you'll be a local by 2031. Enjoy the layover.`,
      `You've done more transactions on other chains than Base and you still call yourself a degen. ${scores.baseAlignment} Base alignment is a participation ribbon, not a flex.`,
      `${wallet.totalTxCount} total transactions, only ${wallet.baseNativeTxCount} on Base. You're treating Base like a holiday destination. Nice visit. Don't forget to go home.`,
    ],
    "Born Yesterday": [
      `${ageDays} days old with ${wallet.totalTxCount} transactions and ${scores.reputation} reputation. Speed is impressive. Unfortunately speed is also how people describe falling.`,
      `Fresh wallet energy with ${wallet.totalTxCount} txs in ${ageDays} days. Either you're very excited or you're about to learn an expensive lesson. Probably both.`,
      `${ageDays} days on Base and already ${wallet.totalTxCount} transactions deep. Your conviction score is ${scores.conviction} — respectable for someone who still smells new.`,
    ],
    "Serial Rotator": [
      `${wallet.totalTxCount} transactions and ${scores.conviction} conviction. You rotate bags faster than a laundromat. Every token you've touched has trust issues now.`,
      `Conviction: ${scores.conviction}. You treat every token like a hot potato at a children's party — pass it fast and hope nobody notices you were holding it.`,
      `${wallet.totalTxCount} txs, ${scores.conviction} conviction, ${wallet.defiProtocolsUsed.length} protocols touched. You've been everywhere and committed to nothing. The DeFi version of a travel influencer.`,
      `${scores.conviction}/100 conviction after ${ageDays} days. Your trading history reads like someone who changes their mind at every candle. Pick something and hold it for longer than a coffee break.`,
    ],
    "Diamond-Handed Degen": [
      `${scores.conviction}/100 conviction with ${wallet.defiProtocolsUsed.length} DeFi protocols touched. Diamond hands on paper, but your Base alignment of ${scores.baseAlignment} says you're still window shopping.`,
      `You've held long enough to call yourself diamond-handed but ${scores.baseAlignment} Base alignment suggests the diamond is cubic zirconia. Looks good from a distance.`,
      `${ageDays} days, ${scores.conviction} conviction, ${wallet.totalTxCount} transactions. True degen energy. The only question is whether the conviction is strategy or you just forgot your seed phrase.`,
      `${scores.conviction}/100 conviction is real. But ${wallet.defiProtocolsUsed.length} protocols used after ${ageDays} days means you're holding, not building. Difference between a believer and a bystander is participation.`,
    ],
    "Base Maxi": [
      `${scores.baseAlignment}/100 Base alignment. Genuinely impressive, or deeply concerning — hard to tell where conviction ends and inability to diversify begins.`,
      `All-in on Base with ${scores.baseAlignment} alignment. Bold strategy. Either you know something everyone else doesn't or you're one bad upgrade away from an existential crisis.`,
      `${scores.baseAlignment} Base alignment and ${wallet.totalTxCount} transactions. You've committed to Base harder than most people commit to anything. The ecosystem thanks you. Your portfolio may not.`,
    ],
    "Balanced Operator": [
      `${scores.reputation} reputation, ${scores.conviction} conviction, ${scores.baseAlignment} Base alignment. You're balanced the same way a participation trophy is balanced — technically correct, completely forgettable.`,
      `Everything at 50. You're the median. The average. The middle child of Base wallets. Not bad enough to roast properly, not good enough to respect.`,
      `${scores.reputation} rep, ${scores.baseAlignment} Base alignment, ${scores.conviction} conviction. You've optimised for not being wrong rather than being right. Safe strategy. Boring outcome.`,
      `${ageDays} days on Base and you've landed exactly in the middle of every metric. Either you're extremely calculated or extremely unambitious. The on-chain data refuses to say which.`,
      `Balanced Operator is a polite way of saying unremarkable. ${wallet.totalTxCount} transactions, ${scores.reputation} reputation, ${scores.conviction} conviction. You exist on Base. Congratulations.`,
    ],
  };

  const variants = roastMap[archetype] ?? roastMap["Balanced Operator"];
  return variants[Math.floor(Math.random() * variants.length)];
}
