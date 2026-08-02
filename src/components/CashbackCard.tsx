"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { apiPost } from "@/lib/client";
import { Icon } from "./Icon";
import { formatFiat } from "@/lib/format";
import { CASHBACK_MIN_CLAIM, CASHBACK_PCT } from "@/lib/constants";

/**
 * Cashback card — earn a slice of every trade back, claimable at the threshold.
 * A sweet loyalty hook that rewards volume.
 */
export function CashbackCard() {
  const { state, refresh, toast } = useApp();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const fiat = state.user.defaultFiat;
  const cashback = state.user.cashback ?? 0;
  const pct = Math.min(100, (cashback / CASHBACK_MIN_CLAIM) * 100);
  const canClaim = cashback >= CASHBACK_MIN_CLAIM;
  const pctLabel = (CASHBACK_PCT * 100).toFixed(2).replace(/\.?0+$/, "");

  async function claim() {
    if (!canClaim) return;
    setLoading(true);
    try {
      await apiPost("/api/cashback");
      await refresh();
      toast("Cashback claimed 🎁", "good");
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl bg-surface border border-white/[.06] p-4 mt-3">
      <button onClick={() => router.push("/account/cashback")} className="w-full flex items-center gap-3 text-left active:opacity-80">
        <span className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-good/[.10] border border-good/25 text-good">
          <Icon name="gift" size={19} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-grotesk font-semibold text-[15px]">Cashback</div>
          <div className="text-white/50 text-[12px]">Earn {pctLabel}% back · tap for history</div>
        </div>
        <div className="text-right flex items-center gap-1.5">
          <div className="font-grotesk font-bold text-[16px] text-good">{formatFiat(cashback, fiat)}</div>
          <Icon name="chevronRight" size={16} className="text-white/30" />
        </div>
      </button>

      {/* progress to claim */}
      <div className="mt-3">
        <div className="h-2 rounded-full bg-white/[.06] overflow-hidden">
          <div className="h-full rounded-full bg-good transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex justify-between text-[11px] text-white/40 mt-1.5">
          <span>{canClaim ? "Ready to claim" : `Claim at ${formatFiat(CASHBACK_MIN_CLAIM, fiat, { decimals: 0 })}`}</span>
          <span>{formatFiat(cashback, fiat, { decimals: 0 })} / {formatFiat(CASHBACK_MIN_CLAIM, fiat, { decimals: 0 })}</span>
        </div>
      </div>

      <button
        onClick={claim}
        disabled={!canClaim || loading}
        className="w-full mt-3 h-11 rounded-xl font-grotesk font-semibold text-[14px] bg-good text-ink disabled:opacity-40 disabled:cursor-not-allowed active:scale-[.99]"
      >
        {loading ? "Claiming…" : canClaim ? `Claim ${formatFiat(cashback, fiat)}` : "Keep trading to unlock"}
      </button>
    </div>
  );
}
