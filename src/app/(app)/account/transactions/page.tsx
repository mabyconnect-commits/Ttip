"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/context/AppContext";
import { apiGet } from "@/lib/client";
import { BackHeader } from "@/components/ui";
import { formatFiat, formatCrypto } from "@/lib/format";
import { prettifyChains } from "@/lib/chains";
import { FIATS } from "@/lib/constants";

interface Txn {
  id: string; type: string; direction: string; counterparty: string | null; note: string | null; emoji: string | null;
  assetIn: string | null; amountIn: number | null; assetOut: string | null; amountOut: number | null; time: string; status: string;
}

const isFiat = (s: string | null) => !!s && FIATS.some((f) => f.code === s);

export default function TransactionsPage() {
  const { state } = useApp();
  const [txns, setTxns] = useState<Txn[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<{ transactions: Txn[] }>("/api/transactions?limit=100")
      .then((d) => setTxns(d.transactions))
      .finally(() => setLoading(false));
  }, []);

  function fmtFiat(v: number, s: string) {
    return formatFiat(v, s, { decimals: s === "USD" ? 2 : 0 });
  }
  function amountText(t: Txn) {
    if (t.direction === "in") {
      const s = t.assetOut ?? state.user.defaultFiat;
      return "+" + (isFiat(s) ? fmtFiat(t.amountOut ?? 0, s) : `${formatCrypto(t.amountOut ?? 0, s)} ${s}`);
    }
    const s = t.assetIn ?? "USDT";
    return "−" + (isFiat(s) ? fmtFiat(t.amountIn ?? 0, s) : `${formatCrypto(t.amountIn ?? 0, s)} ${s}`);
  }

  return (
    <div className="flex flex-col flex-1 px-[22px] min-h-0">
      <BackHeader title="Transactions" />
      <div className="flex-1 overflow-y-auto no-scrollbar pb-6">
        {loading && <div className="text-center text-white/40 text-[13px] py-10">Loading…</div>}
        {!loading && txns.length === 0 && <div className="text-center text-white/40 text-[13px] py-10">No transactions yet.</div>}
        <div className="flex flex-col gap-2 mt-1">
          {txns.map((t) => (
            <div key={t.id} className="flex items-center gap-3 bg-surface border border-white/[.06] rounded-[16px] px-3.5 py-3">
              <span className="w-10 h-10 rounded-full bg-surface2 flex items-center justify-center text-lg shrink-0">{t.emoji ?? "•"}</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-[13.5px] truncate">{prettifyChains(t.note) || label(t.type)}</div>
                <div className="text-white/40 text-[11.5px] truncate">
                  {prettifyChains(t.counterparty) || label(t.type)} · {t.time}
                  {t.status !== "completed" ? ` · ${t.status}` : ""}
                </div>
              </div>
              <b className="font-grotesk text-[13.5px] shrink-0" style={{ color: t.direction === "in" ? "#3DF5B0" : "#FF7A8A" }}>
                {amountText(t)}
              </b>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function label(type: string) {
  const m: Record<string, string> = {
    swap: "Swap", ttip_out: "Ttip sent", ttip_in: "Ttip received", deposit: "Deposit",
    withdraw_wallet: "Sent to wallet", withdraw_bank: "Bank payout", bill: "Bill payment",
    card_fund: "Card funding", card_spend: "Card spend", referral_bonus: "Referral bonus",
    buy: "Crypto purchase", cashback: "Cashback", deposit_bonus: "First deposit bonus",
    admin_adjust: "Balance adjustment",
  };
  return m[type] ?? type;
}
