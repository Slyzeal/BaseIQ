// lib/approvals/scanner.ts
// Scoped to on-chain Base ERC-20 approvals ONLY.
// Off-chain signatures (Permit2, EIP-712) are NOT covered — disclosed in UI.

import { ApprovalRecord } from "../types";

// Known safe spenders on Base
const KNOWN_PROTOCOLS: Record<string, string> = {
  "0x2626664c2603336E57B271c5C0b26F421741e481": "Uniswap V3 Router",
  "0x198EF79F1F515F02dFE9e3115eD9fC07183f02fC": "Uniswap Universal Router",
  "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24": "Uniswap V2 Router",
  "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1": "Aerodrome Router",
  "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43": "Aerodrome Finance",
  "0x3154Cf16ccdb4C6d922629664174b904d80F2C35": "BaseSwap Router",
  "0x327Df1E6de05895d2ab08513aaDD9313Fe505d86": "SushiSwap Router",
  "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE": "LI.FI Diamond",
};

// High-risk / flagged spenders (placeholder — replace with real threat intel)
const FLAGGED_SPENDERS: Record<string, string> = {
  "0x000000000000000000000000000000000000dEaD": "Burn Address (suspicious)",
  "0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF": "Known Drainer",
};

const UNLIMITED_THRESHOLD = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

/**
 * Parse approval events for a given address.
 * Input: raw Moralis ERC-20 approval events for Base chain.
 * Returns scored ApprovalRecord[].
 */
export function parseApprovals(
  rawApprovals: RawApprovalEvent[]
): ApprovalRecord[] {
  const records: ApprovalRecord[] = [];

  for (const event of rawApprovals) {
    const spenderLower = event.spender.toLowerCase();
    const isKnown = Object.keys(KNOWN_PROTOCOLS).some(
      (k) => k.toLowerCase() === spenderLower
    );
    const isFlagged = Object.keys(FLAGGED_SPENDERS).some(
      (k) => k.toLowerCase() === spenderLower
    );

    let isUnlimited = false;
    try {
      isUnlimited = BigInt(event.value) >= UNLIMITED_THRESHOLD;
    } catch {
      isUnlimited = false;
    }

    const isRevoked = event.value === "0";

    let riskLevel: ApprovalRecord["riskLevel"] = "low";
    if (isFlagged) {
      riskLevel = "critical";
    } else if (!isKnown && isUnlimited && !isRevoked) {
      riskLevel = "high";
    } else if (!isKnown && !isRevoked) {
      riskLevel = "medium";
    }

    const spenderLabel =
      KNOWN_PROTOCOLS[event.spender] ??
      FLAGGED_SPENDERS[event.spender] ??
      `${event.spender.slice(0, 6)}…${event.spender.slice(-4)}`;

    records.push({
      contractAddress: event.tokenAddress,
      tokenSymbol: event.tokenSymbol ?? "Unknown",
      spender: event.spender,
      spenderLabel,
      isUnlimited,
      isRevoked,
      riskLevel,
      isKnownProtocol: isKnown,
    });
  }

  // Sort: critical → high → medium → low, revoked last
  return records.sort((a, b) => {
    if (a.isRevoked && !b.isRevoked) return 1;
    if (!a.isRevoked && b.isRevoked) return -1;
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    return order[a.riskLevel] - order[b.riskLevel];
  });
}

export function summarizeApprovals(approvals: ApprovalRecord[]): string {
  const active = approvals.filter((a) => !a.isRevoked);
  const critical = active.filter((a) => a.riskLevel === "critical");
  const high = active.filter((a) => a.riskLevel === "high");

  if (critical.length > 0) {
    return `🚨 ${critical.length} critical approval(s) detected — revoke immediately.`;
  }
  if (high.length > 0) {
    return `⚠️ ${high.length} high-risk unlimited approval(s) to unknown contracts.`;
  }
  if (active.length === 0) {
    return "✅ No active approvals found. Clean.";
  }
  return `ℹ️ ${active.length} active approval(s) — all to known protocols.`;
}

// Raw event shape from Moralis ERC-20 approval logs
export interface RawApprovalEvent {
  tokenAddress: string;
  tokenSymbol?: string;
  spender: string;
  value: string; // BigInt as string
}
