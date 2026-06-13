// app/api/og/route.tsx
// Share card OG image — 1200×630
// Includes: archetype, scores, roast, tx count, contracts deployed, jeet count, verdict tags

import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const address   = searchParams.get("address") ?? "0x???";
  const rep       = searchParams.get("rep") ?? "0";
  const base      = searchParams.get("base") ?? "0";
  const conv      = searchParams.get("conv") ?? "0";
  const arch      = searchParams.get("arch") ?? "Balanced Operator";
  const emoji     = searchParams.get("emoji") ?? "⚖️";
  const roast     = searchParams.get("roast") ?? "";
  const txCount   = searchParams.get("txCount") ?? "0";
  const deployed  = searchParams.get("deployed") ?? "0";
  const jeets     = searchParams.get("jeets") ?? "0";
  const tags      = searchParams.get("tags") ?? "";
  const pnl       = searchParams.get("pnl") ?? "";

  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
  const verdictTags = tags ? tags.split("|").slice(0, 4) : [];

  // Truncate roast to fit card
  const roastText = roast.length > 140 ? roast.slice(0, 137) + "…" : roast;

  const scoreColor = (v: string) => {
    const n = parseInt(v);
    return n >= 70 ? "#f5a623" : n >= 40 ? "#e8d5a3" : "#7a6e58";
  };

  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          background: "#0a0a08",
          display: "flex",
          flexDirection: "column",
          padding: "48px 56px",
          fontFamily: "monospace",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Ambient glow top-left */}
        <div style={{
          position: "absolute", top: -120, left: -80,
          width: 500, height: 500,
          background: "radial-gradient(circle, rgba(245,166,35,0.07) 0%, transparent 70%)",
          borderRadius: "50%",
        }} />

        {/* Ambient glow bottom-right */}
        <div style={{
          position: "absolute", bottom: -150, right: -80,
          width: 400, height: 400,
          background: "radial-gradient(circle, rgba(245,166,35,0.05) 0%, transparent 70%)",
          borderRadius: "50%",
        }} />

        {/* Top bar: BASEIQ wordmark + address */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#f5a623", letterSpacing: "0.22em" }}>
            BASEIQ
          </div>
          <div style={{ fontSize: 13, color: "#7a6e58", letterSpacing: "0.05em" }}>
            {short}
          </div>
        </div>

        {/* Main content: left column + right column */}
        <div style={{ display: "flex", gap: 48, flex: 1 }}>

          {/* LEFT COLUMN */}
          <div style={{ display: "flex", flexDirection: "column", flex: "0 0 420px" }}>

            {/* Archetype */}
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
              <span style={{ fontSize: 52 }}>{emoji}</span>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: "#f5a623", lineHeight: 1.1 }}>
                  {arch}
                </div>
              </div>
            </div>

            {/* Scores */}
            <div style={{ display: "flex", gap: 28, marginBottom: 24 }}>
              {[
                { label: "REP", value: rep },
                { label: "BASE", value: base },
                { label: "CONV", value: conv },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 52, fontWeight: 700, color: scoreColor(value), lineHeight: 1 }}>
                    {value}
                  </span>
                  <span style={{ fontSize: 10, color: "#7a6e58", letterSpacing: "0.1em", marginTop: 4 }}>
                    {label}
                  </span>
                </div>
              ))}
            </div>

            {/* Verdict tags */}
            {verdictTags.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 24 }}>
                {verdictTags.map(tag => (
                  <div key={tag} style={{
                    fontSize: 10,
                    padding: "4px 10px",
                    border: "1px solid rgba(245,166,35,0.35)",
                    borderRadius: 4,
                    color: "#f5a623",
                    background: "rgba(245,166,35,0.06)",
                    letterSpacing: "0.06em",
                  }}>
                    {tag}
                  </div>
                ))}
              </div>
            )}

            {/* Stats row: tx, deployed, jeets, pnl */}
            <div style={{ display: "flex", gap: 20 }}>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 20, fontWeight: 700, color: "#e8d5a3" }}>
                  {parseInt(txCount).toLocaleString()}
                </span>
                <span style={{ fontSize: 10, color: "#7a6e58", letterSpacing: "0.08em", marginTop: 2 }}>TXS</span>
              </div>
              {parseInt(deployed) > 0 && (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 20, fontWeight: 700, color: "#e8d5a3" }}>{deployed}</span>
                  <span style={{ fontSize: 10, color: "#7a6e58", letterSpacing: "0.08em", marginTop: 2 }}>DEPLOYED</span>
                </div>
              )}
              {parseInt(jeets) > 0 && (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 20, fontWeight: 700, color: "#ff4444" }}>{jeets}</span>
                  <span style={{ fontSize: 10, color: "#7a6e58", letterSpacing: "0.08em", marginTop: 2 }}>JEETS</span>
                </div>
              )}
              {pnl && (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 20, fontWeight: 700, color: pnl.startsWith("-") ? "#ff4444" : "#f5a623" }}>
                    {pnl.startsWith("-") ? "" : "+"}{pnl}
                  </span>
                  <span style={{ fontSize: 10, color: "#7a6e58", letterSpacing: "0.08em", marginTop: 2 }}>PNL</span>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT COLUMN: Roast */}
          <div style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            borderLeft: "1px solid rgba(245,166,35,0.15)",
            paddingLeft: 40,
          }}>
            <div style={{ fontSize: 11, color: "#f5a623", letterSpacing: "0.12em", marginBottom: 14 }}>
              🔥 ROAST
            </div>
            <div style={{
              fontSize: 18,
              lineHeight: 1.65,
              color: "#e8d5a3",
              fontStyle: "italic",
            }}>
              "{roastText}"
            </div>
          </div>
        </div>

        {/* Bottom accent line */}
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0, height: 3,
          background: "linear-gradient(90deg, transparent, #f5a623, transparent)",
        }} />

        {/* Footer URL */}
        <div style={{
          position: "absolute", bottom: 18, right: 56,
          fontSize: 12, color: "#3a3428", letterSpacing: "0.06em",
        }}>
          base-iq.vercel.app
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
