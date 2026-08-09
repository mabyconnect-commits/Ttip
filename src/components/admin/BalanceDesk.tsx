"use client";

import { useState } from "react";

/**
 * Fix a user's balance by hand — the clickable front end for /api/admin/balance.
 *
 * Built for mis-credits: a deposit that landed as the wrong asset or amount, or
 * as a junk balance (e.g. a Bitcoin address that leaked into the asset field and
 * minted a "bc1q…" line). You can:
 *   - look up a user and see every balance they hold,
 *   - remove a junk balance row outright (the row whose "symbol" isn't a real
 *     ticker), and
 *   - credit or debit a real asset to make them whole.
 *
 * Every action is audited server-side (who, why) and idempotent.
 */

interface Bal {
  symbol: string;
  kind: string;
  amount: number;
}
interface Recent {
  id: string;
  type: string;
  asset?: string | null;
  amount: number;
  note?: string | null;
  createdAt: string;
}
interface LoadResult {
  user?: { id: string; email: string; username: string; name: string };
  balances?: Bal[];
  recent?: Recent[];
  error?: string;
}

// A real asset ticker is short and alphanumeric. Anything longer (a 40-char
// address) is junk that should be removed, not adjusted — flag it in the UI.
const looksJunk = (symbol: string) => !/^[A-Za-z0-9]{2,8}$/.test(symbol);

const newKey = () => `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export function BalanceDesk() {
  const [q, setQ] = useState("");
  const [data, setData] = useState<LoadResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // credit/debit form
  const [symbol, setSymbol] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  async function load() {
    const user = q.trim();
    if (!user) return;
    setLoading(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/admin/balance?user=${encodeURIComponent(user)}`, { cache: "no-store" });
      const j: LoadResult = await r.json();
      setData(r.ok ? j : { error: j.error ?? (r.status === 404 ? "Not an admin account." : `Error ${r.status}`) });
    } catch {
      setData({ error: "Couldn't reach the server." });
    } finally {
      setLoading(false);
    }
  }

  async function removeJunk(sym: string) {
    if (!data?.user) return;
    if (!confirm(`Remove the "${sym.length > 16 ? sym.slice(0, 16) + "…" : sym}" balance? This deletes the junk line. Credit the real asset separately.`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/balance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "removeBalance",
          user: data.user.id,
          symbol: sym,
          reason: "Remove junk balance from mis-credited deposit",
          idempotencyKey: newKey(),
        }),
      });
      const j = await r.json();
      if (r.ok) {
        setMsg({ ok: true, text: `Removed ${sym.length > 16 ? sym.slice(0, 16) + "…" : sym}.` });
        await load();
      } else {
        setMsg({ ok: false, text: j.error ?? "Removal failed." });
      }
    } catch {
      setMsg({ ok: false, text: "Couldn't reach the server." });
    } finally {
      setBusy(false);
    }
  }

  async function submitAdjust() {
    if (!data?.user) return;
    const delta = Number(amount);
    if (!symbol.trim() || !Number.isFinite(delta) || delta === 0) {
      setMsg({ ok: false, text: "Enter an asset and a non-zero amount." });
      return;
    }
    if (reason.trim().length < 3) {
      setMsg({ ok: false, text: "Add a reason (it's the audit trail)." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/balance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          user: data.user.id,
          symbol: symbol.trim().toUpperCase(),
          delta,
          reason: reason.trim(),
          idempotencyKey: newKey(),
        }),
      });
      const j = await r.json();
      if (r.ok) {
        setMsg({ ok: true, text: j.alreadyApplied ? "Already applied." : `${delta > 0 ? "Credited" : "Debited"} ${Math.abs(delta)} ${symbol.toUpperCase()}. New balance: ${j.newBalance}.` });
        setAmount("");
        setReason("");
        await load();
      } else {
        setMsg({ ok: false, text: j.error ?? "Adjustment failed." });
      }
    } catch {
      setMsg({ ok: false, text: "Couldn't reach the server." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="font-grotesk font-semibold text-[14px] mt-6 mb-2">Fix a balance</div>

      <div className="rounded-2xl bg-surface border border-white/[.08] p-4">
        <div className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
            placeholder="email, @username or id"
            className="flex-1 h-[44px] rounded-xl bg-ink border border-white/10 px-3.5 text-[14px] outline-none focus:border-brand-cyan/60"
            autoCapitalize="none"
            autoCorrect="off"
          />
          <button
            onClick={load}
            disabled={loading || !q.trim()}
            className="h-[44px] px-4 rounded-xl bg-white text-[#07080D] font-grotesk font-semibold text-[13.5px] disabled:opacity-50"
          >
            {loading ? "…" : "Load"}
          </button>
        </div>

        {data?.error && <div className="text-bad text-[12.5px] mt-3">{data.error}</div>}

        {data?.user && (
          <div className="mt-4">
            <div className="text-[13px]">
              <b className="font-grotesk font-semibold">{data.user.name}</b>{" "}
              <span className="text-white/45">@{data.user.username}</span>
            </div>
            <div className="text-white/40 text-[11.5px]">{data.user.email}</div>

            <div className="mt-3 flex flex-col gap-1.5">
              <div className="text-white/45 text-[11.5px] uppercase tracking-wide">Balances</div>
              {(data.balances ?? []).length === 0 && <div className="text-white/40 text-[12.5px]">No balances.</div>}
              {(data.balances ?? []).map((b) => {
                const junk = looksJunk(b.symbol);
                return (
                  <div key={b.symbol} className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 ${junk ? "bg-bad/10 border border-bad/25" : "bg-ink border border-white/[.06]"}`}>
                    <div className="min-w-0">
                      <div className={`text-[13px] font-grotesk font-semibold truncate ${junk ? "text-bad" : ""}`}>
                        {junk ? `${b.symbol.slice(0, 18)}${b.symbol.length > 18 ? "…" : ""}` : b.symbol}
                      </div>
                      <div className="text-white/40 text-[11px]">
                        {b.amount.toLocaleString("en-US", { maximumFractionDigits: 8 })} · {junk ? "junk — not a real asset" : b.kind}
                      </div>
                    </div>
                    {junk ? (
                      <button
                        onClick={() => removeJunk(b.symbol)}
                        disabled={busy}
                        className="shrink-0 h-[32px] px-3 rounded-lg bg-bad/20 text-bad font-grotesk font-semibold text-[12px] disabled:opacity-50"
                      >
                        Remove
                      </button>
                    ) : (
                      <button
                        onClick={() => setSymbol(b.symbol)}
                        className="shrink-0 h-[32px] px-3 rounded-lg bg-white/10 font-grotesk font-semibold text-[12px]"
                      >
                        Use
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Credit / debit */}
            <div className="mt-4 rounded-xl bg-ink border border-white/[.06] p-3">
              <div className="text-white/45 text-[11.5px] uppercase tracking-wide mb-2">Credit / debit</div>
              <div className="flex gap-2">
                <input
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  placeholder="BTC"
                  className="w-[86px] h-[40px] rounded-lg bg-surface border border-white/10 px-3 text-[13.5px] outline-none focus:border-brand-cyan/60"
                  autoCapitalize="characters"
                />
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00031659 (− to debit)"
                  inputMode="decimal"
                  className="flex-1 h-[40px] rounded-lg bg-surface border border-white/10 px-3 text-[13.5px] outline-none focus:border-brand-cyan/60"
                />
              </div>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason (audit trail) — e.g. Fix BTC deposit mis-credit"
                className="mt-2 w-full h-[40px] rounded-lg bg-surface border border-white/10 px-3 text-[13.5px] outline-none focus:border-brand-cyan/60"
              />
              <button
                onClick={submitAdjust}
                disabled={busy}
                className="mt-2 w-full h-[44px] rounded-xl grad-bg text-[#07080D] font-grotesk font-bold text-[14px] disabled:opacity-50"
              >
                {busy ? "Working…" : "Apply adjustment"}
              </button>
            </div>

            {msg && <div className={`mt-3 text-[12.5px] ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</div>}

            {(data.recent ?? []).length > 0 && (
              <div className="mt-4">
                <div className="text-white/45 text-[11.5px] uppercase tracking-wide mb-1.5">Recent deposits & adjustments</div>
                <div className="flex flex-col gap-1">
                  {(data.recent ?? []).map((t) => (
                    <div key={t.id} className="flex justify-between text-[11.5px] text-white/55">
                      <span className="truncate mr-2">{t.type} · {t.asset ?? ""} {t.amount.toLocaleString("en-US", { maximumFractionDigits: 8 })}</span>
                      <span className="text-white/30 shrink-0">{new Date(t.createdAt).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
