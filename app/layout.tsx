// app/layout.tsx

import type { Metadata } from "next";
import { IBM_Plex_Mono, Geist } from "next/font/google";
import "./globals.css";

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-mono",
});

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
});

export const metadata: Metadata = {
  title: "BaseIQ — Wallet Reputation Analyzer",
  description:
    "Scan any Base wallet. Get reputation scores, archetype classification, approval hygiene, and a CT-style roast.",
  openGraph: {
    title: "BaseIQ — Wallet Reputation Analyzer",
    description: "Scan any Base wallet. Get your score.",
    images: ["/api/og"],
  },
  other: {
    // Farcaster / Base App Mini App embed meta
    "fc:frame": "vNext",
    "fc:frame:image": `${process.env.NEXT_PUBLIC_URL ?? "https://baseiq.xyz"}/api/og`,
    "fc:frame:button:1": "Scan a Wallet",
    "fc:frame:button:1:action": "link",
    "fc:frame:button:1:target": process.env.NEXT_PUBLIC_URL ?? "https://baseiq.xyz",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${ibmPlexMono.variable} ${geist.variable}`}>
      <body>{children}</body>
    </html>
  );
}
