"use client";

import { useMemo, useState } from "react";
import { Sheet } from "@/components/ui";
import { NIGERIAN_BANKS, type Bank } from "@/lib/banks";

const COLORS = ["#6D5BFF", "#2AC8FF", "#3DF5B0", "#FF9A5B", "#FF5B8F", "#B45BFF", "#FFC85B"];
function colorFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function BankPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (b: Bank) => void;
}) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return NIGERIAN_BANKS;
    return NIGERIAN_BANKS.filter((b) => b.name.toLowerCase().includes(s));
  }, [q]);

  return (
    <Sheet open={open} onClose={onClose} title="Choose bank">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by bank name"
        autoFocus
        className="w-full h-12 rounded-2xl bg-surface border border-white/10 px-4 mb-3 outline-none focus:border-brand-cyan/50 text-[14px]"
      />
      <div className="flex flex-col gap-1">
        {list.map((b) => (
          <button
            key={b.name}
            onClick={() => { onPick(b); onClose(); }}
            className="flex items-center gap-3 rounded-2xl px-3 py-2.5 active:bg-white/5 text-left"
          >
            <span
              className="w-9 h-9 rounded-full flex items-center justify-center font-grotesk font-bold text-[14px] text-[#04121A] shrink-0"
              style={{ background: colorFor(b.name) }}
            >
              {b.name.charAt(0).toUpperCase()}
            </span>
            <span className="flex-1 text-[14px] font-medium">{b.name}</span>
          </button>
        ))}
        {list.length === 0 && <div className="text-center text-white/40 text-[13px] py-6">No bank matches “{q}”.</div>}
      </div>
    </Sheet>
  );
}
