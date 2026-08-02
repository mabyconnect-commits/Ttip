"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { NIGERIAN_BANKS, type Bank } from "@/lib/banks";

const COLORS = ["#6D5BFF", "#2AC8FF", "#3DF5B0", "#FF9A5B", "#FF5B8F", "#B45BFF", "#FFC85B"];
function colorFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

// Popular Nigerian banks to surface first when the search is empty.
const POPULAR = ["Opay (Paycom)", "Palmpay", "Kuda Microfinance Bank", "Access Bank", "Guaranty Trust Bank (GTBank)", "United Bank For Africa (UBA)", "Zenith Bank", "First Bank of Nigeria", "Moniepoint Microfinance Bank"];

/**
 * Full-screen bank picker. Search is pinned at the top with the results scrolling
 * directly beneath it, so the on-screen keyboard never covers the matches — no
 * more dismissing the keyboard to reach your bank.
 */
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

  useEffect(() => {
    if (!open) return;
    setQ("");
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s) return NIGERIAN_BANKS.filter((b) => b.name.toLowerCase().includes(s));
    // No query → popular banks first, then the rest.
    const pop = POPULAR.map((n) => NIGERIAN_BANKS.find((b) => b.name === n)).filter(Boolean) as Bank[];
    const popNames = new Set(pop.map((b) => b.name));
    return [...pop, ...NIGERIAN_BANKS.filter((b) => !popNames.has(b.name))];
  }, [q]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-ink flex flex-col">
      {/* header + search, pinned */}
      <div className="px-[22px] pt-4 pb-3 border-b border-white/[.06]">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-surface flex items-center justify-center text-white/80"><Icon name="back" size={18} /></button>
          <span className="font-grotesk font-bold text-[18px]">Choose bank</span>
        </div>
        <div className="flex items-center gap-2 bg-surface border border-white/10 rounded-2xl px-3.5 h-12 focus-within:border-brand-cyan/50">
          <Icon name="search" size={17} className="text-white/40 shrink-0" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by bank name"
            autoFocus
            className="flex-1 bg-transparent outline-none text-[14px]"
          />
          {q && <button onClick={() => setQ("")} className="text-white/40"><Icon name="plus" size={16} className="rotate-45" /></button>}
        </div>
      </div>

      {/* scrollable results — always above the keyboard */}
      <div className="flex-1 overflow-y-auto no-scrollbar px-[22px] py-2">
        {!q && <div className="text-white/35 text-[11px] font-semibold uppercase tracking-wide mt-2 mb-1">Popular</div>}
        <div className="flex flex-col gap-0.5 pb-6">
          {list.map((b) => (
            <button
              key={b.name}
              onClick={() => { onPick(b); onClose(); }}
              className="flex items-center gap-3 rounded-2xl px-2.5 py-3 active:bg-white/5 text-left"
            >
              <span
                className="w-9 h-9 rounded-full flex items-center justify-center font-grotesk font-bold text-[14px] text-[#04121A] shrink-0"
                style={{ background: colorFor(b.name) }}
              >
                {b.name.charAt(0).toUpperCase()}
              </span>
              <span className="flex-1 text-[14.5px] font-medium">{b.name}</span>
            </button>
          ))}
          {list.length === 0 && <div className="text-center text-white/40 text-[13px] py-10">No bank matches “{q}”.</div>}
        </div>
      </div>
    </div>
  );
}
