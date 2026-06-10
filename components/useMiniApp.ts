// components/useMiniApp.ts
// Detects whether the app is running inside Base App / Farcaster as a Mini App.
// Exposes viewer address and username for one-tap prefill.

"use client";

import { useEffect, useState } from "react";

interface MiniAppContext {
  isMiniApp: boolean;
  viewerAddress: string | null;
  viewerUsername: string | null;
}

export function useMiniApp(): MiniAppContext {
  const [ctx, setCtx] = useState<MiniAppContext>({
    isMiniApp: false,
    viewerAddress: null,
    viewerUsername: null,
  });

  useEffect(() => {
    // Check for Farcaster / Base App Mini App SDK
    // The SDK injects window.parent context when running embedded
    try {
      const w = window as any;

      // Base App / Farcaster Mini App SDK pattern
      if (w.ReactNativeWebView || w.__FARCASTER_CONTEXT__) {
        const fc = w.__FARCASTER_CONTEXT__;
        setCtx({
          isMiniApp: true,
          viewerAddress: fc?.address ?? null,
          viewerUsername: fc?.username ?? null,
        });
        return;
      }

      // Farcaster frame context via postMessage handshake
      const handleMessage = (e: MessageEvent) => {
        if (e.data?.type === "frameContext") {
          setCtx({
            isMiniApp: true,
            viewerAddress: e.data?.context?.address ?? null,
            viewerUsername: e.data?.context?.username ?? null,
          });
        }
      };

      window.addEventListener("message", handleMessage);
      // Request context from host
      window.parent.postMessage({ type: "requestFrameContext" }, "*");

      return () => window.removeEventListener("message", handleMessage);
    } catch {
      // Not in a Mini App — normal browser
    }
  }, []);

  return ctx;
}
