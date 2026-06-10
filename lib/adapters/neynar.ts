// lib/adapters/neynar.ts
// Farcaster / Base App social data via Neynar API.
// Returns null gracefully if address has no Farcaster identity.

import { SocialData } from "../types";

const NEYNAR_BASE = "https://api.neynar.com/v2/farcaster";

function getNeynarKey(): string {
  const key = process.env.NEYNAR_API_KEY;
  if (!key) throw new Error("NEYNAR_KEY_MISSING");
  return key;
}

export async function fetchSocialData(
  address: string
): Promise<SocialData | null> {
  try {
    const key = getNeynarKey();

    // Look up Farcaster user by custody/verified address
    const res = await fetch(
      `${NEYNAR_BASE}/user/bulk-by-address?addresses=${address}`,
      {
        headers: {
          accept: "application/json",
          api_key: key,
        },
      }
    );

    if (!res.ok) return null;
    const data = await res.json();

    const users: any[] = data[address.toLowerCase()] ?? [];
    if (users.length === 0) return null;

    const user = users[0];
    const profile = user.profile ?? {};

    // Check for Base username (.base.eth or basename)
    const verifiedAddresses: string[] = user.verified_addresses?.eth_addresses ?? [];
    const hasBaseUsername = !!user.username?.endsWith(".base") || false;
    const baseUsername = hasBaseUsername ? user.username : undefined;

    // Heuristic: which Base apps has this user interacted with?
    const basedAppsUsed = detectBasedApps(user);

    return {
      hasFarcaster: true,
      farcasterUsername: user.username,
      farcasterFid: user.fid,
      followerCount: user.follower_count ?? 0,
      followingCount: user.following_count ?? 0,
      castCount: user.cast_count ?? profile.cast_count ?? 0,
      basedAppsUsed,
      hasBaseUsername,
      baseUsername,
    };
  } catch {
    return null;
  }
}

function detectBasedApps(user: any): string[] {
  const apps: string[] = [];
  // These are inferred from known Farcaster channel / app activity
  // In production, you'd cross-reference cast channel IDs
  const channels: string[] = user.active_channels ?? [];
  const channelMap: Record<string, string> = {
    base: "Base",
    "base-builds": "Base Builds",
    farcaster: "Farcaster",
    zora: "Zora",
    "mint-club": "Mint Club",
    superrare: "SuperRare",
  };
  for (const ch of channels) {
    if (channelMap[ch]) apps.push(channelMap[ch]);
  }
  return apps;
}
