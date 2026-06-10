// lib/types.ts

export interface WalletData {
  address: string;
  totalTxCount: number;
  uniqueContractsInteracted: number;
  baseNativeTxCount: number;
  firstTxTimestamp: number | null;
  lastTxTimestamp: number | null;
  tokenHoldings: TokenHolding[];
  nftHoldings: NftHolding[];
  totalPortfolioUsd: number;
  spamTokenCount: number;
  defiProtocolsUsed: string[];
  bridgeCount: number;
}

export interface TokenHolding {
  symbol: string;
  name: string;
  contractAddress: string;
  balance: number;
  usdValue: number;
  isSpam: boolean;
  chain: string;
}

export interface NftHolding {
  name: string;
  contractAddress: string;
  count: number;
}

export interface SocialData {
  hasFarcaster: boolean;
  farcasterUsername?: string;
  farcasterFid?: number;
  followerCount: number;
  followingCount: number;
  castCount: number;
  basedAppsUsed: string[];
  hasBaseUsername: boolean;
  baseUsername?: string;
}

export interface ApprovalRecord {
  contractAddress: string;
  tokenSymbol: string;
  spender: string;
  spenderLabel: string;
  isUnlimited: boolean;
  isRevoked: boolean;
  riskLevel: "low" | "medium" | "high" | "critical";
  isKnownProtocol: boolean;
}

export interface Scores {
  reputation: number;       // 0–100
  baseAlignment: number;    // 0–100
  conviction: number;       // 0–100
  social: number | null;    // 0–100 or null if no Farcaster
}

export type Archetype =
  | "Ghost"
  | "Tourist"
  | "Born Yesterday"
  | "Serial Rotator"
  | "Diamond-Handed Degen"
  | "Base Maxi"
  | "Balanced Operator";

export interface ScanResult {
  address: string;
  scores: Scores;
  archetype: Archetype;
  archetypeEmoji: string;
  verdictTags: string[];
  summary: string;
  roast: string;
  approvals: ApprovalRecord[];
  approvalRiskSummary: string;
  socialData: SocialData | null;
  rarityPercentile: number;
  scannedAt: number;
  dataSource: "moralis" | "alchemy" | "publicRpc" | "cache";
}

export interface ScanRequest {
  address: string;
}

export interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}
