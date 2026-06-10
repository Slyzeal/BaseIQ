// app/api/og/route.tsx
// Generates share card OG images via @vercel/og

import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const address = searchParams.get("address") ?? "0x???";
  const rep = searchParams.get("rep") ?? "0";
  const base = searchParams.get("base") ?? "0";
  const conv = searchParams.get("conv") ?? "0";
  const arch = searchParams.get("arch") ?? "Balanced Operator";
  const emoji = searchParams.get("emoji") ?? "⚖️";

  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          background: "#0a0a08",
          display: "flex",
          flexDirection: "column",
          padding: "60px",
          fontFamily: "monospace",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Amber glow background */}
        <div
          style={{
            position: "absolute",
            top: "-100px",
            left: "-100px",
            width: "500px",
            height: "500px",
            background: "radial-gradient(circle, rgba(245,166,35,0.08) 0%, transparent 70%)",
            borderRadius: "50%",
          }}
        />

        {/* BASEIQ wordmark */}
        <div
          style={{
            fontSize: "18px",
            fontWeight: 700,
            color: "#f5a623",
            letterSpacing: "0.2em",
            marginBottom: "40px",
          }}
        >
          BASEIQ
        </div>

        {/* Address */}
        <div
          style={{
            fontSize: "14px",
            color: "#7a6e58",
            marginBottom: "32px",
            letterSpacing: "0.05em",
          }}
        >
          {short}
        </div>

        {/* Archetype */}
        <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "48px" }}>
          <span style={{ fontSize: "64px" }}>{emoji}</span>
          <div>
            <div
              style={{
                fontSize: "42px",
                fontWeight: 700,
                color: "#f5a623",
                lineHeight: 1,
              }}
            >
              {arch}
            </div>
          </div>
        </div>

        {/* Scores row */}
        <div style={{ display: "flex", gap: "48px" }}>
          {[
            { label: "REPUTATION", value: rep },
            { label: "BASE ALIGN", value: base },
            { label: "CONVICTION", value: conv },
          ].map(({ label, value }) => (
            <div key={label} style={{ display: "flex", flexDirection: "column" }}>
              <span
                style={{
                  fontSize: "64px",
                  fontWeight: 700,
                  color: parseInt(value) >= 70 ? "#f5a623" : parseInt(value) >= 40 ? "#e8d5a3" : "#7a6e58",
                  lineHeight: 1,
                }}
              >
                {value}
              </span>
              <span
                style={{
                  fontSize: "12px",
                  color: "#7a6e58",
                  letterSpacing: "0.1em",
                  marginTop: "6px",
                }}
              >
                {label}
              </span>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            position: "absolute",
            bottom: "40px",
            right: "60px",
            fontSize: "13px",
            color: "#7a6e58",
            letterSpacing: "0.05em",
          }}
        >
          baseiq.xyz
        </div>

        {/* Bottom border accent */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: "3px",
            background: "linear-gradient(90deg, transparent, #f5a623, transparent)",
          }}
        />
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
