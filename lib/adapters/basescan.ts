// lib/adapters/basescan.ts
// Basescan (Etherscan V2) adapter for accurate Base transaction history.
// Free tier: 5 calls/sec, 100k calls/day.
// Used to get real tx count, first/last tx timestamps, and contract interactions.
// Complements Moralis — Basescan gives full history, Moralis gives token/PnL data.

const BASESCAN_BASE = "https://api.basescan.org/api";
const BASE_CHAIN_ID = 8453;

async function basescanFetch(params: Record<string, string>): Promise<any> {
  const apiKey = process.env.BASESCAN_API_KEY;
  if (!apiKey) return null;

  const query = new URLSearchParams({
    ...params,
    apikey: apiKey,
  });

  const res = await fetch(`${BASESCAN_BASE}?${query.toString()}`);
  if (!res.ok) return null;

  const data = await res.json();
  if (data.status === "0" && data.message !== "No transactions found") return null;
  return data;
}

export interface BasescanTxSummary {
  totalTxCount: number;
  firstTxTimestamp: number | null;
  lastTxTimestamp: number | null;
  uniqueContractsInteracted: Set<string>;
  bridgeCount: number;
  contractLabels: Map<string, string>; // address → label if known
}

export async function fetchTxSummary(address: string): Promise<BasescanTxSummary | null> {
  try {
    // Fetch last 100 txs (desc) and first 1 tx (asc) in parallel
    const [recentData, firstData] = await Promise.allSettled([
      basescanFetch({
        module: "account",
        action: "txlist",
        address,
        page: "1",
        offset: "100",
        sort: "desc",
      }),
      basescanFetch({
        module: "account",
        action: "txlist",
        address,
        page: "1",
        offset: "1",
        sort: "asc",
      }),
    ]);

    // Get total tx count via txlistinternal or use page count heuristic
    const totalData = await basescanFetch({
      module: "account",
      action: "txlist",
      address,
      page: "1",
      offset: "10000", // max allowed by Basescan free tier
      sort: "asc",
    });

    const recentTxs: any[] = recentData.status === "fulfilled" && recentData.value?.result
      ? recentData.value.result
      : [];

    const firstTxs: any[] = firstData.status === "fulfilled" && firstData.value?.result
      ? firstData.value.result
      : [];

    const allTxs: any[] = totalData?.result ?? recentTxs;

    if (allTxs.length === 0 && recentTxs.length === 0) return null;

    const txs = allTxs.length > 0 ? allTxs : recentTxs;
    const totalTxCount = txs.length;

    // First tx timestamp — from the asc query
    const firstTx = firstTxs[0] ?? txs[txs.length - 1];
    const lastTx = recentTxs[0] ?? txs[0];

    const firstTxTimestamp = firstTx?.timeStamp
      ? parseInt(firstTx.timeStamp) * 1000
      : null;

    const lastTxTimestamp = lastTx?.timeStamp
      ? parseInt(lastTx.timeStamp) * 1000
      : null;

    const uniqueContractsInteracted = new Set<string>();
    const contractLabels = new Map<string, string>();
    let bridgeCount = 0;

    for (const tx of txs) {
      const to = (tx.to ?? "").toLowerCase();
      if (to && to !== address.toLowerCase()) {
        uniqueContractsInteracted.add(to);
      }

      // Bridge detection via method ID or known bridge contracts
      if (KNOWN_BASE_BRIDGES[to]) {
        bridgeCount++;
        contractLabels.set(to, KNOWN_BASE_BRIDGES[to]);
      }

      // Label known protocols
      if (KNOWN_BASE_CONTRACTS[to]) {
        contractLabels.set(to, KNOWN_BASE_CONTRACTS[to]);
      }
    }

    return {
      totalTxCount,
      firstTxTimestamp,
      lastTxTimestamp,
      uniqueContractsInteracted,
      bridgeCount,
      contractLabels,
    };
  } catch {
    return null;
  }
}

export async function fetchInternalTxCount(address: string): Promise<number> {
  try {
    const data = await basescanFetch({
      module: "account",
      action: "txlistinternal",
      address,
      page: "1",
      offset: "1",
      sort: "desc",
    });
    // Internal tx count isn't directly available — use as signal only
    return data?.result?.length ?? 0;
  } catch {
    return 0;
  }
}

// Known Base bridge contracts
const KNOWN_BASE_BRIDGES: Record<string, string> = {
  "0x3154cf16ccdb4c6d922629664174b904d80f2c35": "Base Bridge",
  "0x49048044d57e1c92a77f79988d21fa8faf74e97e": "Base Bridge",
  "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae": "LiFi Bridge",
  "0x3a23f943181408eac424116af7b7790c94cb97a5": "Socket Bridge",
  "0x9de443adc5a411e83f1878ef24c3f52c61571e72": "Stargate",
};

// Known Base contracts for labeling
const KNOWN_BASE_CONTRACTS: Record<string, string> = {
  "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24": "Uniswap V3",
  "0x2626664c2603336e57b271c5c0b26f421741e481": "Uniswap V3",
  "0x6ff5693b99212da76ad316178a184ab56d299b43": "Aerodrome",
  "0x420dd381b31aef6683db6b902084cb0ffece40da": "Aerodrome",
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": "USDC",
  "0x4200000000000000000000000000000000000006": "WETH",
  "0x940181a94a35a4569e4529a3cdfb74e38fd98631": "Aerodrome",
  "0xcf77a3ba9a5ca399b7c97c74d54e5b1beb874e43": "Aerodrome",
};
