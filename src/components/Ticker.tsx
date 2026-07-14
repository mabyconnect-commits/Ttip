"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/client";
import { formatFiatCompact } from "@/lib/format";
import type { PricePair } from "@/lib/types";

export function Ticker() {
  const [pairs, setPairs] = useState<PricePair[]>([]);

  useEffect(() => {
    let active = true;
    const load = () =>
      apiGet<{ pairs: PricePair[] }>("/api/prices")
        .then((d) => active && setPairs(d.pairs))
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  if (!pairs.length) {
    return <div className="border-y border-white/[.06] py-[7px] mt-2 h-[29px]" />;
  }
  const row = [...pairs, ...pairs];

  return (
    <div className="overflow-hidden border-y border-white/[.06] py-[7px] mt-2">
      <div className="flex gap-[26px] w-max animate-ticker font-grotesk font-medium text-[11px] whitespace-nowrap">
        {row.map((p, i) => {
          const up = p.change >= 0;
          return (
            <span key={i} className="text-white/60">
              {p.pair}{" "}
              <b style={{ color: up ? "#3DF5B0" : "#FF7A8A" }}>
                {formatFiatCompact(p.value, p.fiat)} {up ? "▲" : "▼"}
                {Math.abs(p.change).toFixed(1)}%
              </b>
            </span>
          );
        })}
      </div>
    </div>
  );
}
