"use client";

import { useEffect, useState } from "react";
import { apiGet } from "./client";

interface PricePayload {
  prices: Record<string, { symbol: string; usd: number; change24h: number }>;
  fiatRates: Record<string, number>;
}

// shared in-memory snapshot so multiple components reuse one fetch
let snapshot: PricePayload | null = null;
const listeners = new Set<(p: PricePayload) => void>();

async function load() {
  try {
    const d = await apiGet<PricePayload>("/api/prices");
    snapshot = d;
    listeners.forEach((l) => l(d));
  } catch {
    /* ignore */
  }
}

export function usePrices() {
  const [data, setData] = useState<PricePayload | null>(snapshot);

  useEffect(() => {
    listeners.add(setData);
    if (!snapshot) load();
    else setData(snapshot);
    const t = setInterval(load, 60_000);
    return () => {
      listeners.delete(setData);
      clearInterval(t);
    };
  }, []);

  function usd(symbol: string): number {
    if (!data) return 0;
    if (data.fiatRates[symbol] !== undefined) return data.fiatRates[symbol];
    return data.prices[symbol]?.usd ?? 0;
  }

  // convert `amount` of `from` into `to`
  function convert(amount: number, from: string, to: string): number {
    if (from === to) return amount;
    const usdVal = amount * usd(from);
    const toUnit = usd(to);
    return toUnit ? usdVal / toUnit : 0;
  }

  return { data, ready: !!data, convert, usdPrice: usd };
}
