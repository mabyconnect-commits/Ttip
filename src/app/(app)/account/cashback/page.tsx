"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/context/AppContext";
import { apiGet, apiPost } from "@/lib/client";
import { BackHeader } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { formatFiat } from "@/lib/format";
import { CASHBACK_MIN_CLAIM, CASHBACK_PCT } from "@/lib/constants";

interface Row { id: string; type: string; amountOut: number | null; assetOut: string | null; note: string | null; time: string }

export default function CashbackPage() {
  const { state, refresh, toast } = useApp();
  const fiat = state.user.defaultFiat;
  const cashback = state.user.cashback ?? 0;
  const pct = Math.min(100, (cashback / CASHBACK_MIN_CLAIM) * 100);
  const canClaim = cashback >= CASHBACK_MIN_CLAIM;
  const pctLabel = (CASHBACK_PCT * 100).toFixed(2).replace(/\.?0+$/, "");

  const [history, setHistory] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);

  function load() {
    apiGet<{ transactions: Row[] }>("/api/transactions?type=cashback&limit=100")
      .then((d) => setHistory(d.transactions))
      .catch(() => {})
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function claim() {
    if (!canClaim) return;
    setClaiming(true);
    try {
      await apiPost("/api/cashback");
      await refresh();
      load();
      toast("Cashback claimed 🎁", "good");
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setClaiming(false);
    }
  }

  return (
    <div className="flex flex-col flex-1 px-[22px] min-h-0">
      <BackHeader title="Cashback" />
      <div className="flex-1 overflow-y-auto no-scrollbar pb-6">
        {/* balance + progress */}
        <div className="rounded-[22px] bg-surface border border-white/[.08] p-5 mt-1 text-center">
          <span className="inline-flex w-12 h-12 rounded-full bg-good/[.10] border border-good/25 text-good items-center justify-center"><Icon name="gift" size={22} /></span>
          <div className="font-grotesk font-bold text-[32px] text-good mt-3 tracking-[-0.5px]">{formatFiat(cashback, fiat)}</div>
          <div className="text-white/50 text-[12.5px] mt-1">Earn {pctLabel}% back on every buy &amp; sell</div>

          <div className="mt-4">
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
            disabled={!canClaim || claiming}
            className="w-full mt-4 h-11 rounded-xl font-grotesk font-semibold text-[14px] bg-good text-ink disabled:opacity-40 active:scale-[.99]"
          >
            {claiming ? "Claiming…" : canClaim ? `Claim ${formatFiat(cashback, fiat)}` : "Keep trading to unlock"}
          </button>
        </div>

        {/* history */}
        <div className="text-white/45 text-[12px] font-semibold uppercase tracking-wide ml-1 mt-6 mb-2">History</div>
        <div className="flex flex-col gap-1.5">
          {history.map((r) => {
            const claimed = r.type === "cashback";
            return (
              <div key={r.id} className="flex items-center gap-3 bg-surface border border-white/[.06] rounded-2xl px-4 py-3">
                <span className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${claimed ? "bg-white/[.06] text-white/70" : "bg-good/[.10] text-good"}`}>
                  <Icon name={claimed ? "arrowUp" : "gift"} size={16} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-[13.5px]">{claimed ? "Claimed to balance" : r.note ?? "Cashback earned"}</div>
                  <div className="text-white/40 text-[11.5px]">{r.time}</div>
                </div>
                <div className={`font-grotesk font-semibold text-[13.5px] ${claimed ? "text-white/70" : "text-good"}`}>
                  {claimed ? "−" : "+"}{formatFiat(r.amountOut ?? 0, r.assetOut ?? fiat)}
                </div>
              </div>
            );
          })}
          {loading && <div className="text-center text-white/40 text-[13px] py-8">Loading…</div>}
          {!loading && history.length === 0 && (
            <div className="text-center text-white/40 text-[13px] py-10">
              No cashback yet.<br />Buy or cash out crypto to start earning {pctLabel}% back.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
