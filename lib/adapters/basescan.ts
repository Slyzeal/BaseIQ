// lib/adapters/basescan.ts
// Basescan (Etherscan V2) adapter for Base mainnet.
// Provides: accurate tx count, timestamps, contracts deployed, contract labels.
// Free tier: 5 calls/sec, 100k calls/day.

const BASESCAN_BASE = "https://api.basescan.org/api";

async function basescanFetch(params: Record<string, string>): Promise<any> {
  const apiKey = process.env.BASESCAN_API_KEY;
  if (!apiKey) return null;

  const query = new URLSearchParams({ ...params, apikey: apiKey });
  try {
    const res = await fetch(`${BASESCAN_BASE}?${query.toString()}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status === "0" && data.message !== "No transactions found") return null;
    return data;
  } catch {
    return null;
  }
}

export interface BasescanTxSummary {
  totalTxCount: number;
  firstTxTimestamp: number | null;
  lastTxTimestamp: number | null;
  uniqueContractsInteracted: Set<string>;
  bridgeCount: number;
  contractLabels: Map<string, string>;
  contractsDeployed: number;
  deployedContractAddresses: string[];
}

export async function fetchTxSummary(address: string): Promise<BasescanTxSummary | null> {
  try {
    const addrLower = address.toLowerCase();

    // Fetch up to 10k txs for full history (Basescan allows offset up to 10000)
    const [allData, firstData] = await Promise.allSettled([
      basescanFetch({ module: "account", action: "txlist", address, page: "1", offset: "10000", sort: "desc" }),
      basescanFetch({ module: "account", action: "txlist", address, page: "1", offset: "1", sort: "asc" }),
    ]);

    const allTxs: any[] = allData.status === "fulfilled" && allData.value?.result
      ? allData.value.result : [];
    const firstTxs: any[] = firstData.status === "fulfilled" && firstData.value?.result
      ? firstData.value.result : [];

    if (allTxs.length === 0) return null;

    const totalTxCount = allTxs.length;
    const firstTx = firstTxs[0] ?? allTxs[allTxs.length - 1];
    const lastTx = allTxs[0];

    const firstTxTimestamp = firstTx?.timeStamp ? parseInt(firstTx.timeStamp) * 1000 : null;
    const lastTxTimestamp = lastTx?.timeStamp ? parseInt(lastTx.timeStamp) * 1000 : null;

    const uniqueContractsInteracted = new Set<string>();
    const contractLabels = new Map<string, string>();
    let bridgeCount = 0;
    const deployedContractAddresses: string[] = [];

    for (const tx of allTxs) {
      const to = (tx.to ?? "").toLowerCase();
      const from = (tx.from ?? "").toLowerCase();

      // Contract deployment: to is empty string
      if (!tx.to || tx.to === "") {
        if (tx.contractAddress) {
          deployedContractAddresses.push(tx.contractAddress);
        }
        continue;
      }

      if (to && to !== addrLower) {
        uniqueContractsInteracted.add(to);
      }

      if (KNOWN_BASE_BRIDGES[to]) {
        bridgeCount++;
        contractLabels.set(to, KNOWN_BASE_BRIDGES[to]);
      }

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
      contractsDeployed: deployedContractAddresses.length,
      deployedContractAddresses,
    };
  } catch {
    return null;
  }
}

const KNOWN_BASE_BRIDGES: Record<string, string> = {
  "0x3154cf16ccdb4c6d922629664174b904d80f2c35": "Base Bridge",
  "0x49048044d57e1c92a77f79988d21fa8faf74e97e": "Base Bridge",
  "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae": "LiFi Bridge",
  "0x3a23f943181408eac424116af7b7790c94cb97a5": "Socket Bridge",
  "0x9de443adc5a411e83f1878ef24c3f52c61571e72": "Stargate",
};

const KNOWN_BASE_CONTRACTS: Record<string, string> = {
  "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24": "Uniswap V3",
  "0x2626664c2603336e57b271c5c0b26f421741e481": "Uniswap V3",
  "0x6ff5693b99212da76ad316178a184ab56d299b43": "Aerodrome",
  "0x420dd381b31aef6683db6b902084cb0ffece40da": "Aerodrome",
  "0x940181a94a35a4569e4529a3cdfb74e38fd98631": "Aerodrome",
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": "USDC",
  "0x4200000000000000000000000000000000000006": "WETH",
};
