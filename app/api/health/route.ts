// app/api/health/route.ts

import { NextResponse } from "next/server";
import { cache } from "../../../lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    timestamp: Date.now(),
    cacheSize: cache.size(),
    version: process.env.npm_package_version ?? "1.0.0",
  });
}
