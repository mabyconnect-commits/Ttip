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
interface Reconciliation {
  heldUsd: number;
  realFundedUsd: number;
  grantsUsd: number;
  withdrawnUsd: number;
  expectedUsd: number;
  unbackedUsd: number;
}
interface Report {
  accounts?: Account[];
  totalRecoverableUsd?: number;
  totalGoneUsd?: number;
  reconciliation?: Reconciliation;
  error?: string;
}
interface DemoResult {
  deleted?: string[];
  skipped?: { email: string; reason: string }[];
  mode?: string;
  error?: string;
}

interface Revenue {
  window?: string;
  fees?: {
    bankTransfers: number;
    fiatDeposits: number;
    swaps: number;
    swapSpread: number;
    cryptoWithdrawals: number;
    buySpread: number;
    sellSpread: number;
    cryptoDeposits: number;
    total: number;
  };
  rewards?: { referralCommission: number; cashback: number; depositBonus: number; total: number };
  netRevenue?: number;
  volume?: number;
  error?: string;
}

const usd = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function AdminFundingPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [demo, setDemo] = useState<DemoResult | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [rev, setRev] = useState<Revenue | null>(null);
  const [days, setDays] = useState<number | null>(null);

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
  async function loadRevenue(d: number | null) {
    setRev(null);
    try {
      const r = await fetch(`/api/admin/revenue${d ? `?days=${d}` : ""}`, { cache: "no-store" });
      setRev(r.ok ? await r.json() : { error: r.status === 404 ? "Not an admin account." : `Error ${r.status}` });
    } catch {
      setRev({ error: "Couldn't reach the server." });
    }
  }

  useEffect(() => {
    load();
    loadRevenue(null);
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
            {/* revenue */}
            <div className="font-grotesk font-semibold text-[14px] mt-2 mb-2">Platform revenue</div>
            <div className="flex gap-2 mb-2">
              {[
                { label: "All time", v: null },
                { label: "30d", v: 30 },
                { label: "7d", v: 7 },
              ].map((o) => (
                <button
                  key={o.label}
                  onClick={() => { setDays(o.v); loadRevenue(o.v); }}
                  className={`h-8 px-3.5 rounded-full border font-grotesk font-semibold text-[12px] ${
                    days === o.v ? "bg-white text-[#07080D] border-white" : "border-white/14 text-white/65"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>

            {!rev ? (
              <div className="rounded-2xl bg-surface border border-white/[.08] p-5 text-center text-white/40 text-[13px]">
                Adding it up…
              </div>
            ) : rev.error ? (
              <div className="rounded-2xl bg-surface border border-white/[.08] p-5 text-center text-white/60 text-[13px]">{rev.error}</div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="rounded-2xl bg-surface border border-good/25 p-4">
                    <div className="text-white/45 text-[11.5px]">Net revenue</div>
                    <div
                      className="font-grotesk font-bold text-[19px] mt-1"
                      style={{ color: (rev.netRevenue ?? 0) < 0 ? "#FF7A8A" : "#3DF5B0" }}
                    >
                      {usd(rev.netRevenue ?? 0)}
                    </div>
                    <div className="text-white/35 text-[10.5px] mt-0.5">fees minus rewards paid</div>
                  </div>
                  <div className="rounded-2xl bg-surface border border-white/[.08] p-4">
                    <div className="text-white/45 text-[11.5px]">Total volume</div>
                    <div className="font-grotesk font-bold text-[19px] mt-1">{usd(rev.volume ?? 0)}</div>
                    <div className="text-white/35 text-[10.5px] mt-0.5">value moved through Ttip</div>
                  </div>
                </div>

                <div className="rounded-2xl bg-surface border border-white/[.08] p-4 mt-2.5">
                  <div className="flex justify-between items-baseline">
                    <span className="font-grotesk font-semibold text-[13.5px]">Fees earned</span>
                    <span className="font-grotesk font-bold text-[15px]">{usd(rev.fees?.total ?? 0)}</span>
                  </div>
                  <div className="flex flex-col gap-2 mt-3">
                    {[
                      ["Bank transfers", rev.fees?.bankTransfers ?? 0],
                      ["Fiat deposits", rev.fees?.fiatDeposits ?? 0],
                      ["Swap fees", rev.fees?.swaps ?? 0],
                      ["Swap spread", rev.fees?.swapSpread ?? 0],
                      ["Crypto withdrawals", rev.fees?.cryptoWithdrawals ?? 0],
                      ["Buy spread", rev.fees?.buySpread ?? 0],
                      ["Sell spread", rev.fees?.sellSpread ?? 0],
                    ].map(([label, v]) => (
                      <div key={label as string} className="flex justify-between text-[12.5px]">
                        <span className="text-white/55">{label as string}</span>
                        <span className="font-grotesk font-semibold">{usd(v as number)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between text-[12.5px] pt-2 border-t border-white/[.06]">
                      <span className="text-white/35">Crypto deposits</span>
                      <span className="text-white/35">free — no fee charged</span>
                    </div>
                    {/* Swaps only started recording their spread recently, so an
                        all-time total that predates that reads too low. */}
                    <div className="text-white/30 text-[10.5px] leading-[1.45] pt-1">
                      Swap spread is only recorded on swaps made after this was added, so
                      all-time understates it. The 30d and 7d windows become accurate once
                      they clear that date.
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl bg-surface border border-white/[.08] p-4 mt-2.5">
                  <div className="flex justify-between items-baseline">
                    <span className="font-grotesk font-semibold text-[13.5px]">Rewards paid out</span>
                    <span className="font-grotesk font-bold text-[15px] text-bad">−{usd(rev.rewards?.total ?? 0)}</span>
                  </div>
                  <div className="flex flex-col gap-2 mt-3">
                    <div className="flex justify-between text-[12.5px]">
                      <span className="text-white/55">Referral commission</span>
                      <span className="font-grotesk font-semibold">{usd(rev.rewards?.referralCommission ?? 0)}</span>
                    </div>
                    <div className="flex justify-between text-[12.5px]">
                      <span className="text-white/55">Cashback</span>
                      <span className="font-grotesk font-semibold">{usd(rev.rewards?.cashback ?? 0)}</span>
                    </div>
                    <div className="flex justify-between text-[12.5px]">
                      <span className="text-white/55">First-deposit bonus</span>
                      <span className="font-grotesk font-semibold">{usd(rev.rewards?.depositBonus ?? 0)}</span>
                    </div>
                  </div>
                </div>
              </>
            )}

            <div className="font-grotesk font-semibold text-[14px] mt-6 mb-2">Ledger reconciliation</div>
            {report?.reconciliation && (
              <div className="rounded-2xl bg-surface border border-warn/30 p-4 mb-3">
                <div className="flex justify-between items-baseline">
                  <span className="font-grotesk font-semibold text-[13.5px]">Unbacked money on the platform</span>
                  <span className="font-grotesk font-bold text-[17px] text-warn">
                    {usd(report.reconciliation.unbackedUsd)}
                  </span>
                </div>
                <div className="flex flex-col gap-1.5 mt-3 text-[12px]">
                  {[
                    ["Users hold", report.reconciliation.heldUsd],
                    ["Real deposits in", report.reconciliation.realFundedUsd],
                    ["Promos granted", report.reconciliation.grantsUsd],
                    ["Withdrawn out", -report.reconciliation.withdrawnUsd],
                  ].map(([label, v]) => (
                    <div key={label as string} className="flex justify-between">
                      <span className="text-white/50">{label as string}</span>
                      <span className="font-grotesk font-semibold">{usd(v as number)}</span>
                    </div>
                  ))}
                </div>
                <p className="text-white/45 text-[11px] mt-3 leading-[1.5]">
                  This is the true size of the hole. The per-account list below only sees fake money where it first
                  entered — once it&apos;s swapped into another asset or Ttipped to someone else it stops matching the
                  deposit that made it, so the per-account totals read LOW. Trust this number for the total.
                </p>
              </div>
            )}

            <div className="font-grotesk font-semibold text-[14px] mt-6 mb-2">Unfunded balances</div>
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
