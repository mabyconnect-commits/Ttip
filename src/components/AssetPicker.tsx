"use client";

import { Sheet } from "@/components/ui";
import { AssetIcon } from "@/components/AssetIcon";
import { formatCrypto } from "@/lib/format";
import { CRYPTO_ASSETS, FIATS } from "@/lib/constants";

export function AssetPicker({
  open,
  onClose,
  onPick,
  symbols,
  balances,
  title,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (s: string) => void;
  symbols: string[];
  balances: { assets: { symbol: string; amount: number; fiatValue: number }[]; fiat: string };
  title: string;
}) {
  const info = (s: string) => {
    const fiat = FIATS.find((f) => f.code === s);
    if (fiat) return { name: fiat.name, glyph: fiat.flag, color: "#151827", isFiat: true };
    const c = CRYPTO_ASSETS.find((a) => a.symbol === s)!;
    return { name: c?.name ?? s, glyph: c?.glyph ?? "", color: c?.color ?? "#2AC8FF", isFiat: false };
  };
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="flex flex-col gap-1.5">
        {symbols.map((s) => {
          const i = info(s);
          const bal = balances.assets.find((a) => a.symbol === s)?.amount ?? 0;
          return (
            <button key={s} onClick={() => onPick(s)} className="flex items-center gap-3 bg-surface border border-white/[.06] rounded-2xl px-3.5 py-3 active:scale-[.99]">
              <AssetIcon color={i.color} glyph={i.glyph} isFiat={i.isFiat} size={36} />
              <div className="flex-1 text-left">
                <div className="font-semibold text-[14px]">{s}</div>
                <div className="text-[11px] text-white/40">{i.name}</div>
              </div>
              {bal > 0 && <div className="text-[12px] text-white/50 font-grotesk">{formatCrypto(bal, s)}</div>}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
