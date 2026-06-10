# README.md
# BaseIQ

**AI-powered wallet reputation analyzer for the Base ecosystem.**

Scan any Base wallet address and get:
- 🧠 Reputation, Base Alignment, Conviction & Social scores
- 🎭 Archetype classification (Ghost, Diamond-Handed Degen, Base Maxi, and more)
- 🏷️ CT-native verdict tags
- 🔥 AI roast powered by GPT-4o-mini (with template fallback)
- 🔐 Approval hygiene scanner (on-chain Base ERC-20 approvals)
- 📊 Shareable OG image card
- ⚡ Farcaster / Base App Mini App ready

---

## Stack

- **Next.js 15** — App Router, edge + Node.js runtimes
- **TypeScript** — strict mode throughout
- **TailwindCSS** — Burnt Signal theme (amber on near-black)
- **Moralis** — primary indexer (free tier, multi-key rotation)
- **Neynar** — Farcaster / Base App social data
- **OpenAI gpt-4o-mini** — AI roasts (optional, falls back to templates)
- **@vercel/og** — share card OG images
- **viem** — address validation

## Free-tier architecture

BaseIQ is designed to run at $0/month:
- Moralis free tier with rotating key pool (bench + daily UTC reset recovery)
- Alchemy alternate fallback (30M CU/month)
- Public Base RPC keyless degraded fallback
- In-memory cache (5-minute TTL, 24-hour stale fallback)
- OpenAI is optional — template roasts work without a key

## Setup

```bash
# 1. Clone
git clone https://github.com/YOURNAME/baseiq.git
cd baseiq

# 2. Install
npm install

# 3. Configure
cp .env.example .env.local
# Fill in your API keys

# 4. Run
npm run dev
```

## Deploy to Vercel

1. Push to GitHub
2. Import repo in [vercel.com](https://vercel.com)
3. Add env vars from `.env.example` in Vercel dashboard
4. Deploy

## Mini App

BaseIQ is a site-first product with Mini App integration layered on top.

To register as a Base App / Farcaster Mini App:
1. Go to [dashboard.base.org](https://dashboard.base.org)
2. Register your app
3. Update `public/.well-known/farcaster.json` with your credentials

## Approval hygiene disclaimer

The approval scanner covers **on-chain ERC-20 approvals only**.  
Off-chain signatures (Permit2, EIP-712) are **not** covered and are disclosed in the UI.

---

Built on Base. Free forever.
