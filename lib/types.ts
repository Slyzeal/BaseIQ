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
  pnlSummary: PnLSummary | null;
  topTrades: TradeRecord[];
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

export interface PnLSummary {
  totalRealizedProfitUsd: number;
  totalRealizedProfitPct: number;
  totalTradeCount: number;
  totalBuys: number;
  totalSells: number;
  totalBoughtVolumeUsd: number;
  totalSoldVolumeUsd: number;
}

export interface TradeRecord {
  tokenSymbol: string;
  tokenName: string;
  realizedProfitUsd: number;
  totalInvestedUsd: number;
  avgBuyPriceUsd: number;
  avgSellPriceUsd: number;
  totalBought: number;
  totalSold: number;
  isWin: boolean;
  roiPct: number;
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
  reputation: number;
  baseAlignment: number;
  conviction: number;
  social: number | null;
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
  pnlSummary: PnLSummary | null;
  topTrades: TradeRecord[];
}

export interface ScanRequest {
  address: string;
}

export interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}
