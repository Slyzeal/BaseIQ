// next.config.js

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow Moralis, Alchemy, Neynar, OpenAI from server components
  serverExternalPackages: [],
  async headers() {
    return [
      {
        // Mini App iframe embed — allow Base App / Farcaster to embed
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "ALLOWALL",
          },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors *",
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
