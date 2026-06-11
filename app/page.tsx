// app/page.tsx
"use client";

import { useState } from "react";
import { ScoreCounter } from "../components/ScoreCounter";
import { useMiniApp } from "../components/useMiniApp";
import type { ScanResult } from "../lib/types";

export default function Home() {
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { isMiniApp, viewerAddress, viewerUsername } = useMiniApp();

  async function handleScan(addr?: string) {
    const target = addr ?? address;
    if (!target.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: target.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Scan failed");
      setResult(data);
    } catch (e: any) {
      setError(e.message ?? "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function handleShare() {
    if (!result) return;
    const params = new URLSearchParams({
      address: result.address,
      rep: String(result.scores.reputation),
      base: String(result.scores.baseAlignment),
      conv: String(result.scores.conviction),
      arch: result.archetype,
      emoji: result.archetypeEmoji,
    });
    window.open(`/api/og?${params.toString()}`, "_blank");
  }

  if (result) {
    return (
      <main className="min-h-screen p-4 md:p-8 max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <span className="font-mono text-sm cursor-pointer" style={{ color: "var(--amber)" }} onClick={() => setResult(null)}>
            ← BASEIQ
          </span>
          <span className="font-mono text-xs" style={{ color: "var(--text-muted)" }}>
            {result.address.slice(0, 6)}…{result.address.slice(-4)}
          </span>
        </div>

        {/* Archetype banner */}
        <div className="card-elevated p-6 mb-6 text-center">
          <div style={{ fontSize: "3rem", lineHeight: 1 }} className="mb-2">{result.archetypeEmoji}</div>
          <div className="font-mono text-xl font-bold mb-1" style={{ color: "var(--amber)" }}>{result.archetype}</div>
          <div className="font-mono text-xs" style={{ color: "var(--text-muted)" }}>TOP {result.rarityPercentile}% OF WALLETS SCANNED</div>
        </div>

        {/* Scores */}
        <div className="grid gap-3 mb-6" style={{ gridTemplateColumns: result.scores.social !== null ? "repeat(4,1fr)" : "repeat(3,1fr)" }}>
          <ScoreCard label="REPUTATION" value={result.scores.reputation} />
          <ScoreCard label="BASE ALIGN" value={result.scores.baseAlignment} />
          <ScoreCard label="CONVICTION" value={result.scores.conviction} />
          {result.scores.social !== null && <ScoreCard label="SOCIAL" value={result.scores.social} />}
        </div>

        {/* Verdict tags */}
        <div className="flex flex-wrap gap-2 mb-6">
          {result.verdictTags.map(tag => (
            <span key={tag} className={`tag ${tag.includes("⚠️") || tag.includes("Critical") ? "tag-critical" : ""}`}>{tag}</span>
          ))}
        </div>

        {/* Analysis */}
        <div className="card mb-4">
          <div className="font-mono text-xs mb-2" style={{ color: "var(--text-muted)" }}>ANALYSIS</div>
          <p className="text-sm leading-relaxed" style={{ color: "var(--text-primary)" }}>{result.summary}</p>
        </div>

        {/* Roast */}
        <div className="card mb-4" style={{ borderColor: "rgba(245,166,35,0.4)" }}>
          <div className="font-mono text-xs mb-2" style={{ color: "var(--amber)" }}>🔥 ROAST</div>
          <p className="text-sm leading-relaxed italic" style={{ color: "var(--phosphor)" }}>{result.roast}</p>
        </div>

        {/* Contracts Deployed */}
        {result.contractsDeployed > 0 && (
          <div className="card mb-4">
            <div className="font-mono text-xs mb-2" style={{ color: "var(--text-muted)" }}>
              CONTRACTS DEPLOYED ON BASE — {result.contractsDeployed}
            </div>
            {result.deployedContractAddresses.slice(0, 5).map((addr, i) => (
              <div key={i} className="flex items-center justify-between py-1 text-xs font-mono border-t" style={{ borderColor: "var(--border)" }}>
                <span style={{ color: "var(--text-muted)" }}>{addr.slice(0, 10)}…{addr.slice(-6)}</span>
                <a
                  href={`https://basescan.org/address/${addr}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--amber)" }}
                >
                  VIEW ↗
                </a>
              </div>
            ))}
          </div>
        )}

        {/* Approval hygiene */}
        <div className="card mb-4">
          <div className="font-mono text-xs mb-2" style={{ color: "var(--text-muted)" }}>APPROVAL HYGIENE</div>
          <div className="text-sm mb-3">{result.approvalRiskSummary}</div>
          {result.approvals.slice(0, 5).map((a, i) => (
            <div key={i} className="flex items-center justify-between py-2 border-t text-xs font-mono" style={{ borderColor: "var(--border)" }}>
              <span style={{ color: "var(--text-muted)" }}>{a.tokenSymbol} → {a.spenderLabel}</span>
              <span className={`tag ${a.riskLevel === "critical" || a.riskLevel === "high" ? "tag-critical" : a.isRevoked ? "tag-safe" : ""}`} style={{ fontSize: "0.6rem" }}>
                {a.isRevoked ? "REVOKED" : a.riskLevel.toUpperCase()}
              </span>
            </div>
          ))}
          <div className="text-xs mt-3 pt-3 border-t" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
            * On-chain ERC-20 approvals only. Off-chain signatures (Permit2, EIP-712) not covered.
          </div>
        </div>

        {/* Jeet Tracker */}
        {result.jeets && result.jeets.length > 0 && (
          <div className="card mb-4">
            <div className="font-mono text-xs mb-1" style={{ color: "var(--text-muted)" }}>
              🧻 JEET TRACKER — WHAT YOU LEFT ON THE TABLE
            </div>
            <div className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
              Tokens you sold that kept pumping
            </div>
            {result.jeets.slice(0, 10).map((j, i) => (
              <div key={i} className="py-2 border-t" style={{ borderColor: "var(--border)" }}>
                <div className="flex items-center justify-between text-xs font-mono">
                  <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{j.tokenSymbol}</span>
                  <span style={{ color: "var(--red-alert)", fontWeight: 600 }}>
                    -${j.missedGains.toLocaleString(undefined, { maximumFractionDigits: 0 })} missed
                  </span>
                </div>
                <div className="flex gap-4 text-xs font-mono mt-1" style={{ color: "var(--text-muted)" }}>
                  <span>sold @ ${j.soldAtPrice < 0.01 ? j.soldAtPrice.toFixed(6) : j.soldAtPrice.toFixed(4)}</span>
                  <span>now @ ${j.currentPrice < 0.01 ? j.currentPrice.toFixed(6) : j.currentPrice.toFixed(4)}</span>
                  <span style={{ color: "var(--amber)" }}>+{j.missedGainsPct.toFixed(0)}% since exit</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Trading PnL */}
        {result.pnlSummary && result.pnlSummary.totalTradeCount > 0 && (
          <div className="card mb-4">
            <div className="font-mono text-xs mb-3" style={{ color: "var(--text-muted)" }}>TRADING PnL — ALL TIME</div>
            <div className="grid grid-cols-2 gap-3 mb-2">
              <div>
                <div className="font-mono text-xl font-bold" style={{ color: result.pnlSummary.totalRealizedProfitUsd >= 0 ? "var(--amber)" : "var(--red-alert)" }}>
                  {result.pnlSummary.totalRealizedProfitUsd >= 0 ? "+" : ""}${Math.abs(result.pnlSummary.totalRealizedProfitUsd).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </div>
                <div className="font-mono text-xs mt-1" style={{ color: "var(--text-muted)" }}>REALIZED P&L</div>
              </div>
              <div>
                <div className="font-mono text-xl font-bold" style={{ color: result.pnlSummary.totalRealizedProfitPct >= 0 ? "var(--amber)" : "var(--red-alert)" }}>
                  {result.pnlSummary.totalRealizedProfitPct >= 0 ? "+" : ""}{result.pnlSummary.totalRealizedProfitPct.toFixed(1)}%
                </div>
                <div className="font-mono text-xs mt-1" style={{ color: "var(--text-muted)" }}>ROI</div>
              </div>
            </div>
            <div className="flex gap-4 text-xs font-mono" style={{ color: "var(--text-muted)" }}>
              <span>{result.pnlSummary.totalTradeCount} trades</span>
              <span>{result.pnlSummary.totalBuys} buys</span>
              <span>{result.pnlSummary.totalSells} sells</span>
              <span>${result.pnlSummary.totalBoughtVolumeUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })} vol</span>
            </div>
          </div>
        )}

        {/* Top Trades */}
        {result.topTrades && result.topTrades.length > 0 && (
          <div className="card mb-6">
            <div className="font-mono text-xs mb-3" style={{ color: "var(--text-muted)" }}>TOP TRADES — BIGGEST WINS & LOSSES</div>
            {result.topTrades.slice(0, 5).map((trade, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-t text-xs font-mono" style={{ borderColor: "var(--border)" }}>
                <div>
                  <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{trade.tokenSymbol}</span>
                  <span style={{ color: "var(--text-muted)", marginLeft: "8px" }}>
                    avg buy ${trade.avgBuyPriceUsd < 0.01 ? trade.avgBuyPriceUsd.toFixed(6) : trade.avgBuyPriceUsd.toFixed(4)}
                    {trade.avgSellPriceUsd > 0 && ` → $${trade.avgSellPriceUsd < 0.01 ? trade.avgSellPriceUsd.toFixed(6) : trade.avgSellPriceUsd.toFixed(4)}`}
                  </span>
                </div>
                <div>
                  <span style={{ color: trade.isWin ? "var(--amber)" : "var(--red-alert)", fontWeight: 600 }}>
                    {trade.isWin ? "+" : ""}${trade.realizedProfitUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </span>
                  <span style={{ color: "var(--text-muted)", marginLeft: "6px" }}>
                    ({trade.roiPct >= 0 ? "+" : ""}{trade.roiPct.toFixed(0)}%)
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Farcaster */}
        {result.socialData?.hasFarcaster && (
          <div className="card mb-6">
            <div className="font-mono text-xs mb-2" style={{ color: "var(--text-muted)" }}>FARCASTER</div>
            <div className="flex items-center gap-4 text-sm font-mono">
              <span style={{ color: "var(--amber)" }}>@{result.socialData.farcasterUsername}</span>
              <span style={{ color: "var(--text-muted)" }}>{result.socialData.followerCount} followers</span>
              <span style={{ color: "var(--text-muted)" }}>{result.socialData.castCount} casts</span>
            </div>
          </div>
        )}

        {/* Action bar */}
        <div className="flex gap-3">
          <button className="btn-ghost flex-1" onClick={() => setResult(null)}>SCAN ANOTHER</button>
          <button className="btn-primary" onClick={handleShare}>SHARE CARD ↗</button>
        </div>

        <div className="text-center mt-6 text-xs font-mono" style={{ color: "var(--text-muted)" }}>
          Scanned via {result.dataSource.toUpperCase()} · {new Date(result.scannedAt).toLocaleTimeString()}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6">
      <div className="mb-12 text-center">
        <div className="font-mono font-bold glow-amber" style={{ fontSize: "clamp(2rem,8vw,3.5rem)", color: "var(--amber)", letterSpacing: "0.15em" }}>
          BASEIQ
        </div>
        <div className="font-mono text-xs mt-2 tracking-widest" style={{ color: "var(--text-muted)" }}>
          WALLET REPUTATION ANALYZER
        </div>
      </div>

      {isMiniApp && viewerAddress && (
        <button className="btn-ghost mb-4" onClick={() => handleScan(viewerAddress)}>
          ⚡ SCAN @{viewerUsername ?? viewerAddress.slice(0, 8)}
        </button>
      )}

      <div className="w-full max-w-lg">
        <input
          className="input-amber mb-3"
          placeholder="0x… or ENS name"
          value={address}
          onChange={e => setAddress(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleScan()}
          disabled={loading}
          autoComplete="off"
          spellCheck={false}
        />
        <button className="btn-primary w-full" onClick={() => handleScan()} disabled={loading || !address.trim()}>
          {loading ? "SCANNING…" : "SCAN WALLET"}
        </button>
      </div>

      {error && (
        <div className="mt-4 font-mono text-sm text-center" style={{ color: "var(--red-alert)" }}>{error}</div>
      )}

      <div className="absolute bottom-6 text-xs font-mono text-center" style={{ color: "var(--text-muted)" }}>
        BASE MAINNET · REAL ON-CHAIN DATA · FREE FOREVER
      </div>
    </main>
  );
}

function ScoreCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="card text-center">
      <ScoreCounter value={value} />
      <div className="font-mono text-xs mt-1" style={{ color: "var(--text-muted)", letterSpacing: "0.05em" }}>{label}</div>
    </div>
  );
}
