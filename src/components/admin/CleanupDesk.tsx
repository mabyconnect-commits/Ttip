"use client";

import { useState } from "react";

/**
 * Two corrections, as buttons.
 *
 * These existed only as URLs, which meant they could not actually be run: a
 * phone browser has no admin session (the app holds it), and opening a POST-only
 * endpoint just returns 405. A repair tool an operator can't reach is the same
 * as no repair tool, while real money sits with the wrong people.
 *
 * Both preview first and act second, and the preview is a real request — what
 * you see is what the button will touch, not an estimate.
 */

interface Suspect {
  externalId: string;
  userId: string | null;
  symbol: string;
  amount: number;
  balanceNow: number;
  correction: { corrected: number; basis: string } | null;
}
interface Trace {
  externalId: string;
  status: string;
  asset: string;
  amount: number;
  chain: string | null;
  user: string;
  transaction: { status: string; asset: string | null; amount: number } | null;
  balanceNow: number | null;
  verdict: string;
  createdAt: string;
}
interface TestCard {
  brand: string;
  faceValue: number;
  faceCurrency?: string;
  charged: number;
  fiat: string;
  status: string;
}

export function CleanupDesk() {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [suspects, setSuspects] = useState<Suspect[] | null>(null);
  const [cards, setCards] = useState<TestCard[] | null>(null);
  const [trace, setTrace] = useState<Trace[] | null>(null);
  const [q, setQ] = useState("");

  async function call(url: string, init?: RequestInit) {
    const res = await fetch(url, { credentials: "include", ...init });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
    return json;
  }

  async function run(key: string, fn: () => Promise<string>) {
    setBusy(key);
    setMsg(null);
    try {
      setMsg(await fn());
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const money = (n: number, fiat: string) =>
    `${fiat} ${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

  return (
    <div className="bg-surface border border-white/[.06] rounded-2xl p-4 mt-3">
      <div className="font-grotesk font-semibold text-[14px]">Clean-up</div>
      <p className="text-[12px] text-white/45 mt-1 leading-relaxed">
        Undo balances that were credited or charged in error. Check first, then apply — nothing moves until you
        press the second button.
      </p>

      {/* mis-credited deposits */}
      <div className="mt-4 pt-3 border-t border-white/[.06]">
        <div className="font-sans font-semibold text-[13px]">Mis-credited deposits</div>
        <div className="text-[11.5px] text-white/45 mt-0.5">
          Deposits credited as raw base units — the ones showing as billions.
        </div>

        <div className="flex gap-2 mt-2.5">
          <button
            onClick={() =>
              run("check-dep", async () => {
                const r = await call("/api/admin/deposits/reverse");
                setSuspects(r.deposits ?? []);
                return r.count ? `${r.count} to reverse.` : "Nothing to reverse — balances are clean.";
              })
            }
            disabled={!!busy}
            className="h-9 px-3.5 rounded-full border border-white/14 text-[12.5px] font-grotesk font-semibold text-white/85 active:scale-95 disabled:opacity-50"
          >
            {busy === "check-dep" ? "Checking…" : "Check"}
          </button>
          <button
            onClick={() =>
              run("fix-dep", async () => {
                const r = await call("/api/admin/deposits/reverse", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ confirm: true }),
                });
                setSuspects([]);
                const short = (r.shortfalls ?? []).length;
                return `Reversed ${r.reversed} of ${r.considered}.${
                  short ? ` ${short} had already been partly spent — see the shortfall.` : ""
                }`;
              })
            }
            disabled={!!busy || !suspects?.length}
            className="h-9 px-3.5 rounded-full bg-bad/15 border border-bad/40 text-[12.5px] font-grotesk font-semibold text-bad active:scale-95 disabled:opacity-40"
          >
            {busy === "fix-dep" ? "Reversing…" : "Reverse all"}
          </button>
          <button
            onClick={() =>
              run("correct-dep", async () => {
                const r = await call("/api/admin/deposits/reverse", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ correct: true }),
                });
                setSuspects([]);
                return `Corrected ${r.corrected}. Balances now hold the real deposited amount.`;
              })
            }
            disabled={!!busy || !suspects?.some((s) => s.correction)}
            className="h-9 px-3.5 rounded-full bg-good/15 border border-good/40 text-[12.5px] font-grotesk font-semibold text-good active:scale-95 disabled:opacity-40"
          >
            {busy === "correct-dep" ? "Fixing…" : "Fix to real amount"}
          </button>
        </div>

        {suspects && suspects.length > 0 && (
          <div className="mt-2.5 flex flex-col gap-1.5 max-h-[190px] overflow-y-auto no-scrollbar">
            {suspects.map((s) => (
              <div key={s.externalId} className="bg-surface2 rounded-xl px-3 py-2 text-[11.5px]">
                <div className="font-grotesk font-semibold text-bad break-all">
                  {s.amount.toLocaleString("en-US")} {s.symbol}
                </div>
                <div className="text-white/40 mt-0.5">
                  holds {s.balanceNow.toLocaleString("en-US")} now · {s.userId ?? "no user"}
                </div>
                {s.correction ? (
                  <div className="text-good mt-1">
                    should be {s.correction.corrected} {s.symbol}
                    <span className="text-white/35"> — {s.correction.basis}</span>
                  </div>
                ) : (
                  <div className="text-[#FFC43D] mt-1">
                    can&apos;t work out the right amount — reverse it and credit by hand
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* test-mode gift cards */}
      <div className="mt-4 pt-3 border-t border-white/[.06]">
        <div className="font-sans font-semibold text-[13px]">Test-mode gift cards</div>
        <div className="text-[11.5px] text-white/45 mt-0.5">
          Cards sold before a real provider was configured. The codes are fake; the money was real.
        </div>

        <div className="flex gap-2 mt-2.5">
          <button
            onClick={() =>
              run("check-gc", async () => {
                const r = await call("/api/admin/giftcards/refund-test");
                setCards(r.orders ?? []);
                const totals = Object.entries(r.totalByCurrency ?? {})
                  .map(([f, v]) => money(v as number, f))
                  .join(", ");
                return r.toRefund ? `${r.toRefund} to refund — ${totals}.` : "Nothing to refund.";
              })
            }
            disabled={!!busy}
            className="h-9 px-3.5 rounded-full border border-white/14 text-[12.5px] font-grotesk font-semibold text-white/85 active:scale-95 disabled:opacity-50"
          >
            {busy === "check-gc" ? "Checking…" : "Check"}
          </button>
          <button
            onClick={() =>
              run("fix-gc", async () => {
                const r = await call("/api/admin/giftcards/refund-test", { method: "POST" });
                setCards([]);
                return `Refunded ${r.refunded} of ${r.found}.${r.failed ? ` ${r.failed} failed — check the logs.` : ""}`;
              })
            }
            disabled={!!busy || !cards?.length}
            className="h-9 px-3.5 rounded-full bg-good/15 border border-good/40 text-[12.5px] font-grotesk font-semibold text-good active:scale-95 disabled:opacity-40"
          >
            {busy === "fix-gc" ? "Refunding…" : "Refund all"}
          </button>
        </div>

        {cards && cards.length > 0 && (
          <div className="mt-2.5 flex flex-col gap-1.5 max-h-[190px] overflow-y-auto no-scrollbar">
            {cards.map((c, i) => (
              <div key={i} className="bg-surface2 rounded-xl px-3 py-2 flex justify-between text-[11.5px]">
                <span className="text-white/75">
                  {c.brand} · {c.faceCurrency ?? ""} {c.faceValue}
                </span>
                <span className="font-grotesk font-semibold">{money(c.charged, c.fiat)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* trace — read only, writes nothing */}
      <div className="mt-4 pt-3 border-t border-white/[.06]">
        <div className="font-sans font-semibold text-[13px]">Find a deposit</div>
        <div className="text-[11.5px] text-white/45 mt-0.5">
          &ldquo;It reached the treasury but never showed up.&rdquo; This says which of three things happened.
          Read only — it changes nothing.
        </div>

        <div className="flex gap-2 mt-2.5">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="@username, email, or blank for latest"
            className="flex-1 min-w-0 bg-surface2 border border-white/[.08] rounded-full px-3.5 h-9 outline-none text-[12.5px] focus:border-brand-cyan/50"
          />
          <button
            onClick={() =>
              run("trace", async () => {
                const r = await call(`/api/admin/deposits/trace?q=${encodeURIComponent(q.trim())}`);
                setTrace(r.deposits ?? []);
                return r.note ?? `${r.count} deposit${r.count === 1 ? "" : "s"} found.`;
              })
            }
            disabled={!!busy}
            className="h-9 px-3.5 rounded-full border border-white/14 text-[12.5px] font-grotesk font-semibold text-white/85 active:scale-95 disabled:opacity-50 shrink-0"
          >
            {busy === "trace" ? "Looking…" : "Find"}
          </button>
        </div>

        {trace && trace.length > 0 && (
          <div className="mt-2.5 flex flex-col gap-1.5 max-h-[280px] overflow-y-auto no-scrollbar">
            {trace.map((t) => (
              <div key={t.externalId} className="bg-surface2 rounded-xl px-3 py-2 text-[11.5px]">
                <div className="flex justify-between gap-2">
                  <span className="font-grotesk font-semibold">
                    {t.amount} {t.asset}
                  </span>
                  <span className="text-white/45 shrink-0">{t.user}</span>
                </div>
                <div className={`mt-1 ${t.status === "review" || !t.transaction ? "text-[#FFC43D]" : "text-good"}`}>
                  {t.verdict}
                </div>
                {t.balanceNow !== null && (
                  <div className="text-white/40 mt-0.5">holds {t.balanceNow} now</div>
                )}
                <div className="text-white/25 mt-0.5 break-all">{t.externalId}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {msg && <div className="mt-3 text-[12px] text-white/70 bg-surface2 rounded-xl px-3 py-2">{msg}</div>}
    </div>
  );
}
