"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { BackHeader, Sheet } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { apiGet } from "@/lib/client";
import { formatFiat, formatCrypto } from "@/lib/format";
import { prettifyChains } from "@/lib/chains";
import { FIATS } from "@/lib/constants";

interface Txn {
  id: string; type: string; direction: string; counterparty: string | null; note: string | null; emoji: string | null;
  assetIn: string | null; amountIn: number | null; assetOut: string | null; amountOut: number | null; time: string; status?: string;
  explorerUrl?: string | null;
}
const isFiat = (s: string | null) => !!s && FIATS.some((f) => f.code === s);
const fmt = (v: number, s: string) => (isFiat(s) ? formatFiat(v, s, { decimals: 0 }) : `${formatCrypto(v, s)} ${s}`);
function amountText(t: Txn): string | null {
  if (t.direction === "in" && t.amountOut) return "+" + fmt(t.amountOut, t.assetOut ?? "");
  if (t.direction === "out" && t.amountIn) return "−" + fmt(t.amountIn, t.assetIn ?? "");
  return null;
}

function title(t: Txn): string {
  const inAmt = () => fmt(t.amountOut ?? 0, t.assetOut ?? "");
  switch (t.type) {
    case "ttip_in": return `You received ${inAmt()} from ${t.counterparty ?? "someone"}`;
    case "ttip_out": return `You Ttipped ${t.counterparty ?? ""}`;
    case "deposit": return `Deposit received · ${t.assetOut}`;
    case "swap": return `Swap settled`;
    case "withdraw_bank": return `Bank payout sent`;
    case "withdraw_wallet": return `Crypto sent`;
    case "bill": return `${t.note ?? "Bill"} delivered`;
    case "card_fund": return `Card funded`;
    case "buy": return `Bought ${t.assetOut ?? "crypto"}`;
    case "referral_bonus": return `Referral bonus · ${t.counterparty ?? ""}`;
    default: return t.note ?? t.type;
  }
}

export default function NotificationsPage() {
  const router = useRouter();
  const { toast } = useApp();
  const [txns, setTxns] = useState<Txn[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<Txn | null>(null);

  function copy(text: string) {
    navigator.clipboard?.writeText(text);
    toast("Copied", "good");
  }

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
            <div className="w-14 h-14 rounded-full border border-white/10 flex items-center justify-center text-white/50"><Icon name="bell" size={22} /></div>
            <div className="font-grotesk font-semibold text-[16px]">You&apos;re all caught up</div>
            <div className="text-white/45 text-[13px]">Tips, deposits and payouts will show up here.</div>
          </div>
        )}
        <div className="flex flex-col gap-2 mt-1">
          {txns.map((t) => (
            <button key={t.id} onClick={() => setSel(t)} className="flex items-start gap-3 bg-surface border border-white/[.06] rounded-[16px] px-3.5 py-3 text-left active:scale-[.99] transition">
              <span className="w-10 h-10 rounded-full bg-surface2 flex items-center justify-center text-lg shrink-0">{t.emoji ?? "•"}</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-[13.5px] leading-snug">{title(t)}</div>
                {t.note && t.type !== "bill" && <div className="text-white/45 text-[12px] mt-0.5 truncate">{prettifyChains(t.note)}</div>}
                <div className="text-white/35 text-[11px] mt-0.5">{t.time === "now" ? "just now" : t.time + " ago"}</div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {amountText(t) && (
                  <span className="font-grotesk font-semibold text-[13px] tabular-nums" style={{ color: t.direction === "in" ? "#3DF5B0" : "#FF7A8A" }}>
                    {amountText(t)}
                  </span>
                )}
                <Icon name="chevronRight" size={15} className="text-white/25" />
              </div>
            </button>
          ))}
        </div>

        {!loading && txns.length > 0 && (
          <button onClick={() => router.push("/account/transactions")} className="w-full mt-4 rounded-2xl border border-white/10 py-3 font-grotesk font-semibold text-[13px] text-white/70 active:scale-[.99]">
            View full transaction history
          </button>
        )}
      </div>

      <Sheet open={!!sel} onClose={() => setSel(null)} title="Transaction details">
        {sel && (
          <div className="flex flex-col">
            <div className="flex flex-col items-center text-center py-2">
              <div className="w-14 h-14 rounded-full bg-surface2 flex items-center justify-center text-2xl">{sel.emoji ?? "•"}</div>
              <div className="font-grotesk font-bold text-[18px] mt-3">{title(sel)}</div>
              <div className={`font-grotesk font-bold text-[24px] mt-1 ${sel.direction === "in" ? "text-good" : "text-white"}`}>
                {sel.direction === "in"
                  ? "+" + fmt(sel.amountOut ?? 0, sel.assetOut ?? "")
                  : "−" + fmt(sel.amountIn ?? 0, sel.assetIn ?? "")}
              </div>
            </div>
            <div className="mt-3 flex flex-col divide-y divide-white/[.06]">
              <DetailRow label="Status" value={(sel.status ?? "completed").replace(/^\w/, (c) => c.toUpperCase())} tone={sel.status === "pending" ? "warn" : "good"} />
              {sel.counterparty && <DetailRow label={sel.type === "deposit" ? "Source" : "To / From"} value={prettifyChains(sel.counterparty)} />}
              {sel.note && <DetailRow label="Note" value={prettifyChains(sel.note)} />}
              <DetailRow label="When" value={sel.time === "now" ? "Just now" : sel.time + " ago"} />
              <DetailRow label="Reference" value={sel.id} mono onCopy={() => copy(sel.id)} />
            </div>

            {sel.explorerUrl && (
              <a
                href={sel.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 flex items-center justify-center gap-2 rounded-2xl border border-white/12 py-3.5 font-grotesk font-semibold text-[13px] text-brand-cyan active:scale-[.99]"
              >
                View on explorer
                <Icon name="share" size={15} />
              </a>
            )}

            <div className="grid grid-cols-2 gap-2.5 mt-2.5">
              <button onClick={() => copy(sel.id)} className="rounded-2xl border border-white/12 py-3.5 font-grotesk font-semibold text-[13px] active:scale-[.99]">
                Copy reference
              </button>
              <button
                onClick={() => { router.push(`/account/support?ref=${sel.id}`); }}
                className="rounded-2xl border border-white/12 py-3.5 font-grotesk font-semibold text-[13px] text-bad active:scale-[.99]"
              >
                Report an issue
              </button>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}

function DetailRow({ label, value, tone, mono, onCopy }: { label: string; value: string; tone?: "good" | "warn"; mono?: boolean; onCopy?: () => void }) {
  const color = tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : "text-white/90";
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <span className="text-[12.5px] text-white/45 shrink-0">{label}</span>
      <span className="flex items-center gap-1.5 min-w-0">
        <span className={`text-[13px] font-medium text-right break-all ${color} ${mono ? "font-mono text-[11px]" : ""}`}>{value}</span>
        {onCopy && (
          <button onClick={onCopy} className="text-white/40 shrink-0 active:text-white/70" aria-label="Copy">
            <Icon name="copy" size={14} />
          </button>
        )}
      </span>
    </div>
  );
}
