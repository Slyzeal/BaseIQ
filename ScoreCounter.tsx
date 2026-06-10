// components/ScoreCounter.tsx
// Animated score counter — counts up from 0 on mount like an instrument powering on.

"use client";

import { useEffect, useRef, useState } from "react";

interface ScoreCounterProps {
  value: number;
  duration?: number; // ms
}

export function ScoreCounter({ value, duration = 1200 }: ScoreCounterProps) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    startRef.current = null;

    function tick(ts: number) {
      if (!startRef.current) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const progress = Math.min(elapsed / duration, 1);

      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(eased * value));

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value, duration]);

  // Color based on score
  const color =
    value >= 70
      ? "var(--amber)"
      : value >= 40
      ? "var(--phosphor)"
      : "var(--text-muted)";

  return (
    <span className="score-number" style={{ color }}>
      {display}
    </span>
  );
}
