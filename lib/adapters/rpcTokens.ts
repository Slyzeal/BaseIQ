// lib/adapters/rpcTokens.ts
// Free token balance fetching via RPC Multicall3.
// Covers top ~15 Base tokens with hardcoded addresses + decimals.
// Returns balances with USD prices from DexScreener/Binance.

import { multicallBalances, getBalance } from "./rpcPool";
import { cache } from "../cache";

// Top Base tokens — hardcoded with decimals
export const BASE_TOKENS = [
  { address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC",  name: "USD Coin",    decimals: 6  },
  { address: "0x4200000000000000000000000000000000000006", symbol: "WETH",  name: "Wrapped ETH", decimals: 18 },
  { address: "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22", symbol: "cbETH", name: "Coinbase ETH",decimals: 18 },
  { address: "0x4ed4e862860bed51a9570b96d89af5e1b0efefed", symbol: "DEGEN", name: "Degen",        decimals: 18 },
  { address: "0x940181a94a35a4569e4529a3cdfb74e38fd98631", symbol: "AERO",  name: "Aerodrome",   decimals: 18 },
  { address: "0x0578d8a44db98b23bf096a382e016e29a5ce0ffe", symbol: "HIGHER",name: "Higher",      decimals: 18 },
  { address: "0xac1bd2486aaf3b5c0fc3fd868558b082a531b2b4", symbol: "TOSHI", name: "Toshi",       decimals: 18 },
  { address: "0x532f27101965dd16442e59d40670faf5ebb142e4", symbol: "BRETT", name: "Brett",       decimals: 18 },
  { address: "0xb1a03eda10342529bbf5f6700f56b6b0e9dd9cf4", symbol: "MOCHI", name: "Mochi",       decimals: 18 },
  { address: "0x768be13e1680b5ebe0024c42c896e3db59ec0149", symbol: "SKI",   name: "Ski Mask Dog",decimals: 18 },
  { address: "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca", symbol: "USDbC", name: "USD Base Coin",decimals: 6 },
  { address: "0x50c5725949a6f0c72e6c4a641f24049a917db0cb", symbol: "DAI",   name: "Dai",         decimals: 18 },
  { address: "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2", symbol: "USDT",  name: "Tether",      decimals: 6  },
  { address: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf", symbol: "cbBTC", name: "Coinbase BTC",decimals: 8  },
];

// Stablecoin addresses — priced at $1, skip DexScreener
const STABLES = new Set([
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // USDC
  "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca", // USDbC
  "0x50c5725949a6f0c72e6c4a641f24049a917db0cb", // DAI
  "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2", // USDT
]);

// ETH-pegged — use ETH price
const ETH_PEGGED = new Set([
  "0x4200000000000000000000000000000000000006", // WETH
  "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22", // cbETH
]);

async function getEthPrice(): Promise<number> {
  const cacheKey = "price:ETH:now";
  const cached = await cache.get<number>(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT");
    if (res.ok) {
      const data = await res.json();
      const price = parseFloat(data.price ?? "0");
      if (price > 0) {
        // 5 min TTL for prices
        const entry = { data: price, expiresAt: Date.now() + 5 * 60 * 1000 };
        // Store directly without full 24hr TTL
        await cache.set(cacheKey, price);
        return price;
      }
    }
  } catch {}
  return 3000;
}

async function getDexScreenerPrice(tokenAddress: string): Promise<number> {
  const cacheKey = `price:${tokenAddress.toLowerCase()}:now`;
  const cached = await cache.get<number>(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return 0;
    const data = await res.json();
    const pair = data.pairs?.find((p: any) => p.chainId === "base");
    const price = parseFloat(pair?.priceUsd ?? "0") || 0;
    if (price > 0) await cache.set(cacheKey, price);
    return price;
  } catch { return 0; }
}

export async function fetchTokenBalances(address: string): Promise<{
  tokens: Array<{ symbol: string; name: string; contractAddress: string; balance: number; usdValue: number; isSpam: boolean; chain: string }>;
  ethBalance: number;
  ethUsdValue: number;
  totalUsd: number;
}> {
  const ethPrice = await getEthPrice();

  // Get ETH balance + token balances in parallel
  const [ethWei, tokenBalances] = await Promise.allSettled([
    getBalance(address),
    multicallBalances(address, BASE_TOKENS),
  ]);

  const ethBalance = ethWei.status === "fulfilled" ? Number(ethWei.value) / 1e18 : 0;
  const ethUsdValue = ethBalance * ethPrice;

  const rawTokens = tokenBalances.status === "fulfilled" ? tokenBalances.value : [];

  // Get prices for non-zero holdings
  const tokensWithPrices = await Promise.all(
    rawTokens.map(async t => {
      let price = 0;
      if (STABLES.has(t.contractAddress.toLowerCase())) price = 1;
      else if (ETH_PEGGED.has(t.contractAddress.toLowerCase())) price = ethPrice;
      else price = await getDexScreenerPrice(t.contractAddress);

      return {
        symbol: t.symbol,
        name: t.name,
        contractAddress: t.contractAddress,
        balance: t.balance,
        usdValue: t.balance * price,
        isSpam: false,
        chain: "base",
      };
    })
  );

  const totalUsd = ethUsdValue + tokensWithPrices.reduce((s, t) => s + t.usdValue, 0);

  return { tokens: tokensWithPrices, ethBalance, ethUsdValue, totalUsd };
}
