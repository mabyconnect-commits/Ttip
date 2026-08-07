"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { formatCrypto, formatFiat } from "@/lib/format";
import { FIATS } from "@/lib/constants";
import { prettifyChains } from "@/lib/chains";

/**
 * Every transaction on the platform.
 *
 * Support questions arrive as a name and an amount — "Kingsley says his ₦10,000
 * never landed" — so the search box takes a name, an email, an account number,
 * a wallet address or a reference, and one of them will hit.
 *
 * Read-only on purpose. The actions that move or reverse money live on the
 * payout desk, where each has a reason and an audit row. A screen that shows
 * everything AND changes anything is one where a mis-tap while scrolling costs
 * somebody their balance.
 */

interface Row {
  id: string;
  type: string;
  status: string;
  assetIn: string | null;
  amountIn: number | null;
  assetOut: string | null;
  amountOut: number | null;
  counterparty: string | null;
  note: string | null;
  emoji: string | null;
  createdAt: string;
  user: { email: string; username: string; name: string };
  reason: string | null;
  reference: string | null;
  surface: string | null;
  network: string | null;
  explorerUrl: string | null;
}

interface Payload {
  transactions?: Row[];
  nextCursor?: string | null;
  counts?: { total: number; pending: number; failed: number };
  error?: string;
}

const INFLOW = new Set(["deposit", "ttip_in", "referral_bonus", "buy", "deposit_bonus"]);
const isFiat = (s: string | null) => !!s && FIATS.some((f) => f.code === s);
const fmt = (v: number, s: string) => (isFiat(s) ? formatFiat(v, s, { decimals: 0 }) : `${formatCrypto(v, s)} ${s}`);

const TYPES = [
  { label: "All", v: "" },
  { label: "Bank out", v: "withdraw_bank" },
  { label: "Crypto out", v: "withdraw_wallet" },
  { label: "Deposits", v: "deposit" },
  { label: "Swaps", v: "swap" },
  { label: "Ttips", v: "ttip_out" },
  { label: "Bills", v: "bill" },
];

function when(iso: string): string {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

const tone = (s: string) => (s === "completed" ? "text-good" : s === "failed" ? "text-bad" : "text-warn");

export function AllTransactions() {
  const [data, setData] = useState<Payload | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<Row | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveMsg, setResolveMsg] = useState<string | null>(null);

  /**
   * Manually resolve a stuck pending payout/withdrawal — paid, or reject+refund.
   * Hits the payout desk (which owns the audit row) and reuses the same safe
   * finalizers as the webhooks, so a reject refunds exactly once.
   */
  async function resolveTx(row: Row, outcome: "paid" | "rejected") {
    const verb = outcome === "paid" ? "mark this as PAID (completed)" : "REJECT this and refund the user";
    const amt = row.amountOut ? `${row.amountOut} ${row.assetOut ?? ""}` : "";
    if (!window.confirm(`Are you sure you want to ${verb}?\n\n${row.user.name} · ${amt}\n${row.counterparty ?? ""}`)) return;
    setResolving(true);
    setResolveMsg(null);
    try {
      const r = await fetch("/api/admin/payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resolveTx", transactionId: row.id, outcome }),
      });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      setResolveMsg(j.message ?? (r.ok ? "Done." : `Error ${r.status}`));
      if (r.ok && j.ok) {
        const newStatus = outcome === "paid" ? "completed" : "failed";
        setOpen((o) => (o && o.id === row.id ? { ...o, status: newStatus } : o));
        setRows((prev) => prev.map((x) => (x.id === row.id ? { ...x, status: newStatus } : x)));
      }
    } catch {
      setResolveMsg("Couldn't reach the server.");
    } finally {
      setResolving(false);
    }
  }

  const load = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      try {
        const p = new URLSearchParams();
        if (q) p.set("q", q);
        if (type) p.set("type", type);
        if (status) p.set("status", status);
        if (cursor) p.set("cursor", cursor);
        const r = await fetch(`/api/admin/transactions?${p}`, { cache: "no-store" });
        const j: Payload = r.ok ? await r.json() : { error: r.status === 404 ? "Not an admin account." : `Error ${r.status}` };
        setData(j);
        setRows((prev) => (cursor ? [...prev, ...(j.transactions ?? [])] : (j.transactions ?? [])));
      } catch {
        setData({ error: "Couldn't reach the server." });
      } finally {
        setLoading(false);
      }
    },
    [q, type, status],
  );

  // Debounced, so typing a name doesn't fire a query per keystroke.
  useEffect(() => {
    const t = setTimeout(() => load(), q ? 400 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  if (data?.error) return null;

  return (
    <>
      <div className="font-grotesk font-semibold text-[14px] mt-6 mb-2">
        All transactions
        {data?.counts && (
          <span className="ml-2 text-white/40 font-normal text-[12px]">
            {data.counts.total.toLocaleString("en-US")}
            {data.counts.pending > 0 && <span className="text-warn"> · {data.counts.pending} pending</span>}
            {data.counts.failed > 0 && <span className="text-bad"> · {data.counts.failed} failed</span>}
          </span>
        )}
      </div>

      <div className="rounded-2xl bg-surface border border-white/[.08] px-4 py-3 flex items-center gap-2.5">
        <Icon name="search" size={15} className="text-white/35 shrink-0" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name, email, account number, reference…"
          className="flex-1 min-w-0 bg-transparent outline-none text-[13.5px]"
        />
        {q && (
          <button onClick={() => setQ("")} className="text-white/40 shrink-0">
            <Icon name="x" size={14} />
          </button>
        )}
      </div>

      <div className="flex gap-2 mt-2.5 overflow-x-auto no-scrollbar">
        {TYPES.map((o) => (
          <button
            key={o.label}
            onClick={() => setType(o.v)}
            className={`h-8 px-3.5 rounded-full border font-grotesk font-semibold text-[12px] shrink-0 ${
              type === o.v ? "bg-white text-[#07080D] border-white" : "border-white/14 text-white/65"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div className="flex gap-2 mt-2">
        {[
          { label: "Any status", v: "" },
          { label: "Pending", v: "pending" },
          { label: "Failed", v: "failed" },
          { label: "Completed", v: "completed" },
        ].map((o) => (
          <button
            key={o.label}
            onClick={() => setStatus(o.v)}
            className={`h-8 px-3.5 rounded-full border font-grotesk font-semibold text-[12px] shrink-0 ${
              status === o.v ? "bg-white text-[#07080D] border-white" : "border-white/14 text-white/65"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 mt-2.5">
        {rows.map((t) => {
          const inflow = INFLOW.has(t.type);
          const amount = inflow
            ? t.amountOut && `+${fmt(t.amountOut, t.assetOut ?? "")}`
            : t.amountOut
              ? `−${fmt(t.amountOut, t.assetOut ?? "")}`
              : t.amountIn && `−${fmt(t.amountIn, t.assetIn ?? "")}`;
          return (
            <button
              key={t.id}
              onClick={() => { setOpen(t); setResolveMsg(null); }}
              className="flex items-start gap-3 bg-surface border border-white/[.06] rounded-[16px] px-3.5 py-3 text-left active:scale-[.99] transition"
            >
              <span className="w-9 h-9 rounded-full bg-surface2 flex items-center justify-center text-[15px] shrink-0">
                {t.emoji ?? "•"}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-[13px] truncate">
                  {t.user.name} <span className="text-white/35">@{t.user.username}</span>
                </div>
                <div className="text-white/45 text-[11.5px] truncate mt-0.5">
                  {t.type.replace(/_/g, " ")}
                  {t.counterparty ? ` · ${prettifyChains(t.counterparty)}` : ""}
                </div>
                <div className="text-white/30 text-[10.5px] mt-0.5">
                  {when(t.createdAt)}
                  {t.surface && t.surface !== "app" ? ` · ${t.surface}` : ""}
                </div>
              </div>
              <div className="text-right shrink-0">
                {amount && <div className="font-grotesk font-semibold text-[12.5px] tabular-nums">{amount}</div>}
                <div className={`text-[10.5px] mt-0.5 ${tone(t.status)}`}>{t.status}</div>
              </div>
            </button>
          );
        })}
      </div>

      {!loading && rows.length === 0 && (
        <div className="rounded-2xl bg-surface border border-white/[.08] p-5 text-center text-white/45 text-[13px] mt-2.5">
          Nothing matches that.
        </div>
      )}

      {loading && (
        <div className="text-center text-white/40 text-[12.5px] py-4">Loading…</div>
      )}

      {data?.nextCursor && !loading && (
        <button
          onClick={() => load(data.nextCursor!)}
          className="w-full mt-2.5 rounded-2xl border border-white/12 py-3 font-grotesk font-semibold text-[13px] text-white/70 active:scale-[.99]"
        >
          Load more
        </button>
      )}

      {/* Detail. Everything support needs to answer the question, in one card. */}
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-4"
          onClick={() => setOpen(null)}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-surface border border-white/10 p-5 max-h-[80vh] overflow-y-auto no-scrollbar"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start gap-3">
              <div>
                <div className="font-grotesk font-bold text-[16px]">{open.user.name}</div>
                <div className="text-white/45 text-[12px]">{open.user.email}</div>
              </div>
              <button onClick={() => setOpen(null)} className="text-white/40 shrink-0">
                <Icon name="x" size={18} />
              </button>
            </div>

            <div className="mt-3 flex flex-col divide-y divide-white/[.06] text-[12.5px]">
              {[
                ["Type", open.type.replace(/_/g, " ")],
                ["Status", open.status],
                ["Reason", open.reason],
                ["In", open.amountIn ? `${open.amountIn} ${open.assetIn ?? ""}` : null],
                ["Out", open.amountOut ? `${open.amountOut} ${open.assetOut ?? ""}` : null],
                ["To / From", open.counterparty ? prettifyChains(open.counterparty) : null],
                ["Network", open.network ? prettifyChains(open.network) : null],
                ["Note", open.note],
                ["Surface", open.surface],
                ["Reference", open.reference],
                ["Transaction id", open.id],
                ["When", new Date(open.createdAt).toLocaleString("en-GB")],
              ]
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k as string} className="flex justify-between gap-3 py-2.5">
                    <span className="text-white/45 shrink-0">{k as string}</span>
                    <span
                      className={`text-right break-all ${
                        k === "Status" ? tone(open.status) : k === "Reason" ? "text-bad" : "text-white/90"
                      }`}
                    >
                      {v as string}
                    </span>
                  </div>
                ))}
            </div>

            {open.explorerUrl && (
              <a
                href={open.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 flex items-center justify-center gap-2 rounded-2xl border border-white/12 py-3 font-grotesk font-semibold text-[13px] text-brand-cyan"
              >
                View on explorer <Icon name="share" size={14} />
              </a>
            )}

            {/* Manual resolution — only for a pending payout / crypto withdrawal.
                Reuses the same idempotent refund/settle path as the webhooks. */}
            {open.status === "pending" && (open.type === "withdraw_bank" || open.type === "withdraw_wallet") && (
              <div className="mt-4 border-t border-white/[.06] pt-4">
                <div className="text-white/40 text-[11px] mb-2.5">
                  Resolve manually — same safe refund/settle path as the automatic reconcile.
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    disabled={resolving}
                    onClick={() => resolveTx(open, "paid")}
                    className="rounded-2xl bg-good text-ink py-3 font-grotesk font-semibold text-[13px] active:scale-[.99] disabled:opacity-50"
                  >
                    Mark paid
                  </button>
                  <button
                    disabled={resolving}
                    onClick={() => resolveTx(open, "rejected")}
                    className="rounded-2xl border border-bad/50 text-bad py-3 font-grotesk font-semibold text-[13px] active:scale-[.99] disabled:opacity-50"
                  >
                    Reject &amp; refund
                  </button>
                </div>
                <div className="text-white/35 text-[10.5px] mt-2 leading-snug">
                  Mark paid = you sent it yourself; the user sees “completed”. Reject = it isn’t going out; the debited balance is returned.
                </div>
              </div>
            )}

            {resolveMsg && (
              <div className="mt-3 text-center text-[12px] text-white/80 bg-surface2 rounded-xl py-2.5 px-3">{resolveMsg}</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
