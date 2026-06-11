// lib/adapters/basescan.ts
// Basescan adapter — real tx count, timestamps, contract deployments.
// Uses eth_getTransactionCount for accurate total and txlistinternal for deployments.

const BASESCAN_BASE = "https://api.basescan.org/api";

async function basescanFetch(params: Record<string, string>): Promise<any> {
  const apiKey = process.env.BASESCAN_API_KEY;
  if (!apiKey) return null;
  const query = new URLSearchParams({ ...params, apikey: apiKey });
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(`${BASESCAN_BASE}?${query.toString()}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status === "0" && data.message !== "No transactions found") return null;
    return data;
  } catch { return null; }
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

    // Fire 3 calls in parallel
    const [recentRes, firstRes, internalRes] = await Promise.allSettled([
      // Recent 100 txs for timestamps + contract interactions
      basescanFetch({ module: "account", action: "txlist", address, page: "1", offset: "100", sort: "desc" }),
      // First tx for wallet age
      basescanFetch({ module: "account", action: "txlist", address, page: "1", offset: "1", sort: "asc" }),
      // Internal txs — captures contract deployments (type: "create")
      basescanFetch({ module: "account", action: "txlistinternal", address, page: "1", offset: "50", sort: "desc" }),
    ]);

    const recentTxs: any[] = recentRes.status === "fulfilled" && recentRes.value?.result
      ? recentRes.value.result : [];
    const firstTxs: any[] = firstRes.status === "fulfilled" && firstRes.value?.result
      ? firstRes.value.result : [];

    if (recentTxs.length === 0 && firstTxs.length === 0) return null;

    // Timestamps
    const firstTx = firstTxs[0] ?? recentTxs[recentTxs.length - 1];
    const lastTx = recentTxs[0];
    const firstTxTimestamp = firstTx?.timeStamp ? parseInt(firstTx.timeStamp) * 1000 : null;
    const lastTxTimestamp = lastTx?.timeStamp ? parseInt(lastTx.timeStamp) * 1000 : null;

    // Real total tx count via eth_getTransactionCount (nonce = tx count)
    let totalTxCount = recentTxs.length;
    const nonceRes = await basescanFetch({
      module: "proxy",
      action: "eth_getTransactionCount",
      address,
      tag: "latest",
    });
    if (nonceRes?.result) {
      const count = parseInt(nonceRes.result, 16);
      if (count > 0) totalTxCount = count;
    }

    // Contract interactions + bridge detection from recent txs
    const uniqueContractsInteracted = new Set<string>();
    const contractLabels = new Map<string, string>();
    let bridgeCount = 0;
    const deployedContractAddresses: string[] = [];

    for (const tx of recentTxs) {
      const to = (tx.to ?? "").toLowerCase();

      // Contract deployment: to is empty
      if (!tx.to || tx.to === "" || tx.to === "0x") {
        if (tx.contractAddress) deployedContractAddresses.push(tx.contractAddress);
        continue;
      }

      if (to && to !== addrLower) uniqueContractsInteracted.add(to);
      if (BRIDGES[to]) { bridgeCount++; contractLabels.set(to, BRIDGES[to]); }
      if (PROTOCOLS[to]) contractLabels.set(to, PROTOCOLS[to]);
    }

    // Internal txs for additional deployment detection
    const internalTxs: any[] = internalRes.status === "fulfilled" && internalRes.value?.result
      ? internalRes.value.result : [];

    for (const tx of internalTxs) {
      if (tx.type === "create" && tx.contractAddress && tx.from?.toLowerCase() === addrLower) {
        if (!deployedContractAddresses.includes(tx.contractAddress)) {
          deployedContractAddresses.push(tx.contractAddress);
        }
      }
    }

    console.log(`[basescan] ${address.slice(0,8)} txCount:${totalTxCount} deployed:${deployedContractAddresses.length} bridges:${bridgeCount}`);

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
  } catch { return null; }
}

const BRIDGES: Record<string, string> = {
  "0x3154cf16ccdb4c6d922629664174b904d80f2c35": "Base Bridge",
  "0x49048044d57e1c92a77f79988d21fa8faf74e97e": "Base Bridge",
  "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae": "LiFi Bridge",
  "0x3a23f943181408eac424116af7b7790c94cb97a5": "Socket Bridge",
  "0x9de443adc5a411e83f1878ef24c3f52c61571e72": "Stargate",
};

const PROTOCOLS: Record<string, string> = {
  "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24": "Uniswap V3",
  "0x2626664c2603336e57b271c5c0b26f421741e481": "Uniswap V3",
  "0x6ff5693b99212da76ad316178a184ab56d299b43": "Aerodrome",
  "0x420dd381b31aef6683db6b902084cb0ffece40da": "Aerodrome",
  "0x940181a94a35a4569e4529a3cdfb74e38fd98631": "Aerodrome",
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": "USDC",
  "0x4200000000000000000000000000000000000006": "WETH",
};
