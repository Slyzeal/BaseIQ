// lib/adapters/rpcPool.ts
// Rotating pool of free public Base RPC endpoints.
// Round-robin with health tracking — benches failed endpoints for 5 minutes.
// Used for: eth_getBalance, eth_getTransactionCount, eth_call (Multicall3)

const ENDPOINTS = [
  "https://mainnet.base.org",
  "https://base.llamarpc.com",
  "https://base-rpc.publicnode.com",
  "https://base.drpc.org",
  "https://1rpc.io/base",
];

interface EndpointEntry {
  url: string;
  benchedUntil: number;
}

const entries: EndpointEntry[] = ENDPOINTS.map(url => ({ url, benchedUntil: 0 }));
let cursor = 0;

function next(): string | null {
  const now = Date.now();
  for (let i = 0; i < entries.length; i++) {
    const idx = (cursor + i) % entries.length;
    if (entries[idx].benchedUntil < now) {
      cursor = (idx + 1) % entries.length;
      return entries[idx].url;
    }
  }
  return null;
}

function bench(url: string) {
  const entry = entries.find(e => e.url === url);
  if (entry) entry.benchedUntil = Date.now() + 5 * 60 * 1000;
}

async function rpcCall(method: string, params: unknown[]): Promise<any> {
  const url = next();
  if (!url) throw new Error("RPC_POOL_EXHAUSTED");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) { bench(url); throw new Error(`RPC_HTTP_${res.status}`); }
    const data = await res.json();
    if (data.error) throw new Error(`RPC_ERROR: ${data.error.message}`);
    return data.result;
  } catch (e) {
    clearTimeout(timeout);
    bench(url);
    throw e;
  }
}

export async function getBalance(address: string): Promise<bigint> {
  const hex = await rpcCall("eth_getBalance", [address, "latest"]);
  return BigInt(hex);
}

export async function getTxCount(address: string): Promise<number> {
  const hex = await rpcCall("eth_getTransactionCount", [address, "latest"]);
  return parseInt(hex, 16);
}

// Multicall3 on Base: 0xcA11bde05977b3631167028862bE2a173976CA11
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";

export async function multicallBalances(
  address: string,
  tokens: Array<{ address: string; symbol: string; decimals: number; name: string }>
): Promise<Array<{ symbol: string; name: string; contractAddress: string; balance: number }>> {
  // Build aggregate call: balanceOf(address) for each token
  const calls = tokens.map(t => ({
    target: t.address,
    allowFailure: true,
    callData: "0x70a08231" + address.slice(2).padStart(64, "0"), // balanceOf(address)
  }));

  // Encode aggregate3 call
  const encodedCalls = encodeAggregate3(calls);

  try {
    const result = await rpcCall("eth_call", [{
      to: MULTICALL3,
      data: encodedCalls,
    }, "latest"]);

    const results = decodeAggregate3Result(result, tokens.length);
    return results.map((r, i) => ({
      symbol: tokens[i].symbol,
      name: tokens[i].name,
      contractAddress: tokens[i].address,
      balance: r.success ? Number(r.value) / Math.pow(10, tokens[i].decimals) : 0,
    })).filter(t => t.balance > 0);
  } catch {
    return [];
  }
}

function encodeAggregate3(calls: Array<{ target: string; allowFailure: boolean; callData: string }>): string {
  // Simple ABI encode for aggregate3((address,bool,bytes)[])
  // Function selector for aggregate3: 0x82ad56cb
  const sel = "82ad56cb";
  const len = calls.length;
  const offset = (32).toString(16).padStart(64, "0");
  const count = len.toString(16).padStart(64, "0");

  let encoded = "0x" + sel + offset + count;

  // Offsets for each struct
  let dataOffset = len * 3 * 32; // each struct has 3 fields minimum
  const offsets: string[] = [];
  const structs: string[] = [];

  for (const call of calls) {
    offsets.push(dataOffset.toString(16).padStart(64, "0"));
    const cd = call.callData.startsWith("0x") ? call.callData.slice(2) : call.callData;
    const cdLen = cd.length / 2;
    const cdPadded = cd.padEnd(Math.ceil(cdLen / 32) * 64, "0");
    const struct = call.target.slice(2).padStart(64, "0") +
      (call.allowFailure ? "1" : "0").padStart(64, "0") +
      (96).toString(16).padStart(64, "0") + // offset to bytes within struct
      cdLen.toString(16).padStart(64, "0") +
      cdPadded;
    structs.push(struct);
    dataOffset += (3 + 1 + Math.ceil(cdLen / 32)) * 32;
  }

  encoded += offsets.join("") + structs.join("");
  return encoded;
}

function decodeAggregate3Result(hex: string, count: number): Array<{ success: boolean; value: bigint }> {
  // Simplified decoder — extract success+returnData for each call
  try {
    const data = hex.startsWith("0x") ? hex.slice(2) : hex;
    const results: Array<{ success: boolean; value: bigint }> = [];

    // Skip array offset (32 bytes) and length (32 bytes)
    let pos = 128; // 0x20 offset + length
    for (let i = 0; i < count; i++) {
      // Each result is offset pointer
      const resultOffset = parseInt(data.slice(64 + i * 64, 128 + i * 64), 16) * 2;
      const success = data.slice(resultOffset, resultOffset + 64) !== "0".repeat(64);
      const dataLen = parseInt(data.slice(resultOffset + 64, resultOffset + 128), 16);
      let value = BigInt(0);
      if (success && dataLen > 0) {
        value = BigInt("0x" + (data.slice(resultOffset + 128, resultOffset + 128 + 64) || "0"));
      }
      results.push({ success, value });
    }
    return results;
  } catch {
    return Array(count).fill({ success: false, value: BigInt(0) });
  }
}
