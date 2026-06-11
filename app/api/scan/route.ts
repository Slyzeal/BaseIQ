// app/api/scan/route.ts

import { NextRequest, NextResponse } from "next/server";
import { scanWallet } from "../../../lib/scanService";
import { isAddress } from "viem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel hobby tier max — prevents 10s timeout kills

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { address, refresh } = body as { address?: string; refresh?: boolean };

    if (!address || typeof address !== "string") {
      return NextResponse.json(
        { error: "address is required" },
        { status: 400 }
      );
    }

    const clean = address.trim().toLowerCase();
    // Preserve original case for API calls — Moralis works better with checksum addresses
    const original = address.trim();

    // Basic validation — accept hex addresses (ENS resolution done client-side or here)
    if (!isAddress(clean) && !clean.endsWith(".eth")) {
      return NextResponse.json(
        { error: "Invalid address or ENS name" },
        { status: 400 }
      );
    }

    const result = await scanWallet(original, refresh === true);
    console.log(`[scan] ${clean} → ${result.dataSource} | rep:${result.scores.reputation} txs:${result.scores.baseAlignment} conv:${result.scores.conviction}`);
    return NextResponse.json(result);
  } catch (e: any) {
    console.error("[/api/scan]", e);
    return NextResponse.json(
      { error: e.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
