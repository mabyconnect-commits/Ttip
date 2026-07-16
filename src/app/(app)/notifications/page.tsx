"use client";

import { useEffect, useState } from "react";
import { BackHeader } from "@/components/ui";
import { apiGet } from "@/lib/client";
import { formatFiat, formatCrypto } from "@/lib/format";
import { FIATS } from "@/lib/constants";

interface Txn {
  id: string; type: string; direction: string; counterparty: string | null; note: string | null; emoji: string | null;
  assetIn: string | null; amountIn: number | null; assetOut: string | null; amountOut: number | null; time: string;
}
const isFiat = (s: string | null) => !!s && FIATS.some((f) => f.code === s);

function title(t: Txn): string {
  const inAmt = () => (isFiat(t.assetOut) ? formatFiat(t.amountOut ?? 0, t.assetOut!, { decimals: 0 }) : `${formatCrypto(t.amountOut ?? 0, t.assetOut ?? "")} ${t.assetOut ?? ""}`);
  switch (t.type) {
    case "ttip_in": return `You received ${inAmt()} from ${t.counterparty ?? "someone"}`;
    case "ttip_out": return `You Ttipped ${t.counterparty ?? ""}`;
    case "deposit": return `Deposit received · ${t.assetOut}`;
    case "swap": return `Swap settled`;
    case "withdraw_bank": return `Bank payout sent`;
    case "withdraw_wallet": return `Crypto sent`;
    case "bill": return `${t.note ?? "Bill"} delivered`;
    case "card_fund": return `Card funded`;
    case "referral_bonus": return `Referral bonus · ${t.counterparty ?? ""}`;
    default: return t.note ?? t.type;
  }
}

export default function NotificationsPage() {
  const [txns, setTxns] = useState<Txn[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<{ transactions: Txn[] }>("/api/transactions?limit=40").then((d) => setTxns(d.transactions)).finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col flex-1 px-[22px] min-h-0">
      <BackHeader title="Notifications" />
      <div className="flex-1 overflow-y-auto no-scrollbar pb-6">
        {loading && <div className="text-center text-white/40 text-[13px] py-10">Loading…</div>}
        {!loading && txns.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center py-16 gap-2">
            <div className="text-4xl">🔔</div>
            <div className="font-grotesk font-semibold text-[16px]">You're all caught up</div>
            <div className="text-white/45 text-[13px]">Tips, deposits and payouts will show up here.</div>
          </div>
        )}
        <div className="flex flex-col gap-2 mt-1">
          {txns.map((t) => (
            <div key={t.id} className="flex items-start gap-3 bg-surface border border-white/[.06] rounded-[16px] px-3.5 py-3">
              <span className="w-10 h-10 rounded-full bg-surface2 flex items-center justify-center text-lg shrink-0">{t.emoji ?? "•"}</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-[13.5px] leading-snug">{title(t)}</div>
                {t.note && t.type !== "bill" && <div className="text-white/45 text-[12px] mt-0.5 truncate">“{t.note}”</div>}
                <div className="text-white/35 text-[11px] mt-0.5">{t.time === "now" ? "just now" : t.time + " ago"}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
