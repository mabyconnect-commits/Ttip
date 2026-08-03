"use client";

import { useEffect, useState } from "react";
import { BackHeader } from "@/components/ui";
import { Icon } from "@/components/Icon";

/**
 * Admin: funding audit + clawback, as buttons.
 *
 * This exists because the same operations were only reachable by pasting a
 * fetch() call into a browser console — which Android Chrome doesn't have, so
 * the snippet ended up in the address bar and got searched instead of run.
 * Anything that moves real money needs a real control.
 *
 * The API 404s for non-admins, so a non-admin just sees the empty state; the
 * page itself grants nothing.
 */

interface Debit {
  symbol: string;
  debit: number;
  shortfall: number;
}
interface Account {
  userId: string;
  email: string;
  username: string;
  debits: Debit[];
  recoverableUsd: number;
  goneUsd: number;
  sources: string[];
}
interface Report {
  accounts?: Account[];
  totalRecoverableUsd?: number;
  totalGoneUsd?: number;
  error?: string;
}
interface DemoResult {
  deleted?: string[];
  skipped?: { email: string; reason: string }[];
  mode?: string;
  error?: string;
}

const usd = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function AdminFundingPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [demo, setDemo] = useState<DemoResult | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/funding", { cache: "no-store" });
      setReport(r.ok ? await r.json() : { error: r.status === 404 ? "Not an admin account." : `Error ${r.status}` });
    } catch {
      setReport({ error: "Couldn't reach the server." });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function post(qs: string, key: string) {
    setBusy(key);
    setMsg(null);
    try {
      const r = await fetch(`/api/admin/funding?${qs}`, { method: "POST" });
      const j = await r.json();
      if (qs.includes("deleteDemo")) setDemo(j);
      else setMsg(j.error ? `${j.error} ${j.note ?? ""}` : `Done — ${j.debitsApplied ?? 0} debit(s) applied.`);
      if (qs.includes("apply=1")) await load();
    } catch {
      setMsg("Request failed.");
    } finally {
      setBusy(null);
    }
  }

  const accounts = report?.accounts ?? [];
  const demoAccounts = accounts.filter((a) => a.email.endsWith("@ttip.money"));
  const realAccounts = accounts.filter((a) => !a.email.endsWith("@ttip.money"));

  return (
    <div className="flex flex-col flex-1 px-[22px] min-h-0">
      <BackHeader title="Funding audit" />
      <div className="flex-1 overflow-y-auto no-scrollbar pb-8">
        {loading ? (
          <div className="flex items-center gap-2 text-[13px] text-white/45 py-10 justify-center">
            <span className="w-4 h-4 rounded-full border-2 border-white/20 border-t-white/60 animate-spin" /> Checking
            every account…
          </div>
        ) : report?.error ? (
          <div className="mt-4 rounded-2xl bg-surface border border-white/[.08] p-5 text-center text-white/60 text-[13.5px]">
            {report.error}
          </div>
        ) : (
          <>
            {/* totals */}
            <div className="grid grid-cols-2 gap-2.5 mt-2">
              <div className="rounded-2xl bg-surface border border-white/[.08] p-4">
                <div className="text-white/45 text-[11.5px]">Recoverable</div>
                <div className="font-grotesk font-bold text-[19px] mt-1">{usd(report?.totalRecoverableUsd ?? 0)}</div>
              </div>
              <div className="rounded-2xl bg-surface border border-bad/25 p-4">
                <div className="text-white/45 text-[11.5px]">Already gone</div>
                <div className="font-grotesk font-bold text-[19px] mt-1 text-bad">{usd(report?.totalGoneUsd ?? 0)}</div>
              </div>
            </div>
            <p className="text-white/40 text-[11.5px] mt-2 leading-snug">
              &ldquo;Already gone&rdquo; left the platform to a real bank or wallet. No ledger change recovers it.
            </p>

            {/* demo accounts */}
            <div className="font-grotesk font-semibold text-[14px] mt-6 mb-2">
              Demo accounts ({demoAccounts.length})
            </div>
            <div className="rounded-2xl bg-surface border border-white/[.08] p-4">
              <p className="text-white/55 text-[12.5px] leading-[1.55]">
                Seeded accounts holding balances nobody paid for. They&apos;re marked verified and share a published
                password, so deleting them — not just zeroing the balance — is what actually closes the door.
              </p>
              {demoAccounts.length > 0 && (
                <div className="text-white/40 text-[11.5px] mt-2 font-mono">
                  {demoAccounts.map((a) => a.email).join(", ")}
                </div>
              )}
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => post("deleteDemo=1", "demo-dry")}
                  disabled={!!busy}
                  className="flex-1 h-11 rounded-xl border border-white/15 font-grotesk font-semibold text-[13px] disabled:opacity-40"
                >
                  {busy === "demo-dry" ? "Checking…" : "Preview"}
                </button>
                <button
                  onClick={() => {
                    if (confirm("Permanently delete the seeded demo accounts? This cannot be undone.")) {
                      post("deleteDemo=1&apply=1", "demo-apply");
                    }
                  }}
                  disabled={!!busy}
                  className="flex-1 h-11 rounded-xl bg-bad/90 text-white font-grotesk font-semibold text-[13px] disabled:opacity-40"
                >
                  {busy === "demo-apply" ? "Deleting…" : "Delete"}
                </button>
              </div>
              {demo && (
                <div className="mt-3 rounded-xl bg-surface2 px-3.5 py-3 text-[12px] text-white/70 leading-[1.55]">
                  <div className="font-semibold text-white">
                    {demo.mode === "applied" ? "Deleted" : "Would delete"}: {demo.deleted?.length ?? 0}
                  </div>
                  {!!demo.deleted?.length && <div className="text-white/50 mt-1 font-mono">{demo.deleted.join(", ")}</div>}
                  {!!demo.skipped?.length && (
                    <div className="text-warn mt-2">
                      Skipped (real money found): {demo.skipped.map((s) => s.email).join(", ")}
                    </div>
                  )}
                  {demo.error && <div className="text-bad mt-1">{demo.error}</div>}
                </div>
              )}
            </div>

            {/* real users */}
            <div className="font-grotesk font-semibold text-[14px] mt-6 mb-2">Real accounts ({realAccounts.length})</div>
            <div className="rounded-2xl px-4 py-3 text-[12.5px] flex items-start gap-2 text-white/70 bg-good/[.06] border border-good/25 mb-2">
              <Icon name="shield" size={14} className="text-good mt-0.5 shrink-0" />
              <span>
                Nothing here is debited unless you tap it. A flat ₦500 is almost certainly the signup bonus, not abuse —
                check <b className="text-white">why</b> below before touching anyone.
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {realAccounts.map((a) => (
                <div key={a.userId} className="rounded-2xl bg-surface border border-white/[.08] p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="font-medium text-[13.5px] truncate">@{a.username}</div>
                    <div className="font-grotesk font-semibold text-[13px] shrink-0">{usd(a.recoverableUsd)}</div>
                  </div>
                  <div className="text-white/40 text-[11.5px] truncate">{a.email}</div>
                  <div className="text-white/55 text-[11.5px] mt-2">
                    {a.debits.map((d) => `${d.debit} ${d.symbol}${d.shortfall ? ` (+${d.shortfall} gone)` : ""}`).join(" · ")}
                  </div>
                  {a.sources?.length > 0 && (
                    <ul className="mt-2 text-white/45 text-[11px] leading-[1.5] list-disc pl-4">
                      {a.sources.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  )}
                  <button
                    onClick={() => {
                      if (confirm(`Debit ${a.email}? Only do this if the reasons above show simulated funds.`)) {
                        post(`apply=1&user=${encodeURIComponent(a.email)}`, a.userId);
                      }
                    }}
                    disabled={!!busy || a.recoverableUsd <= 0}
                    className="w-full mt-3 h-10 rounded-xl border border-bad/40 text-bad font-grotesk font-semibold text-[12.5px] disabled:opacity-30"
                  >
                    {busy === a.userId ? "Debiting…" : "Debit this account"}
                  </button>
                </div>
              ))}
              {realAccounts.length === 0 && (
                <div className="text-center text-white/40 text-[13px] py-6">No real accounts flagged. 🎉</div>
              )}
            </div>

            {msg && <div className="mt-4 rounded-xl bg-surface2 px-4 py-3 text-[12.5px] text-white/70">{msg}</div>}
            <button onClick={load} disabled={!!busy} className="w-full mt-4 h-11 rounded-xl border border-white/15 font-grotesk font-semibold text-[13px]">
              Refresh
            </button>
          </>
        )}
      </div>
    </div>
  );
}
