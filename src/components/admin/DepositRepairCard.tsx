"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/Icon";

/**
 * Admin: correct deposits mis-credited by the origin/settlement asset mix-up —
 * the bug that credited someone's 0.4 SOL as 0.4 USDC.
 *
 * Each correction is its own button. There is deliberately no "fix all": every
 * one of these moves real balance, and the rows the provider gave us no settled
 * figure for need a human to read the transfer off-chain and type the number in.
 */

interface Finding {
  settlementId: string;
  externalId: string;
  userId: string | null;
  userEmail: string | null;
  username: string | null;
  createdAt: string;
  creditedAsset: string;
  creditedAmount: number;
  trueSettlementAsset: string | null;
  trueSettlementAmount: number | null;
  originAsset: string | null;
  originAmount: number | null;
  delta: number | null;
  verdict: "MIS_CREDITED" | "NEEDS_MANUAL";
  alreadyRepaired: boolean;
  estimate: {
    asset: string;
    amount: number;
    unitPriceUsd: number;
    feeRate: number;
    caveat: string;
  } | null;
}

interface Report {
  findings?: Finding[];
  counts?: { total: number; repairable: number; manual: number };
  error?: string;
}

export function DepositRepairCard() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [manual, setManual] = useState<Record<string, { asset: string; amount: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setMsg("");
    try {
      const r = await fetch("/api/admin/deposit-repair", { cache: "no-store" });
      setReport(
        r.ok
          ? await r.json()
          : { error: r.status === 404 ? "Not an admin account." : `Error ${r.status}` },
      );
    } catch {
      setReport({ error: "Couldn't reach the server." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function repair(f: Finding) {
    const entry = manual[f.settlementId];
    const needsManual = f.verdict === "NEEDS_MANUAL";

    if (needsManual && (!entry?.asset?.trim() || !Number(entry?.amount))) {
      setMsg("Enter the settled asset and amount from the block explorer first.");
      return;
    }

    const who = f.userEmail ?? f.username ?? "this user";
    const to = needsManual ? `${entry.amount} ${entry.asset.toUpperCase()}` : `${f.trueSettlementAmount} ${f.trueSettlementAsset}`;
    if (
      !window.confirm(
        `Correct ${who}'s deposit?\n\nCredited: ${f.creditedAmount} ${f.creditedAsset}\nCorrect to: ${to}\n\nThis moves real balance.`,
      )
    ) {
      return;
    }

    setBusyId(f.settlementId);
    setMsg("");
    try {
      const r = await fetch("/api/admin/deposit-repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settlementId: f.settlementId,
          ...(needsManual ? { asset: entry.asset.trim(), amount: Number(entry.amount) } : {}),
        }),
      });
      const d = await r.json();
      setMsg(
        r.ok
          ? `Corrected: ${d.from.amount} ${d.from.asset} → ${d.to.amount} ${d.to.asset}`
          : d.error || "Could not correct that deposit.",
      );
      await load();
    } catch {
      setMsg("Couldn't reach the server.");
    } finally {
      setBusyId(null);
    }
  }

  const findings = report?.findings ?? [];
  const outstanding = findings.filter((f) => !f.alreadyRepaired);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon name="shield" className="h-4 w-4 text-amber-400" />
          <h3 className="text-sm font-medium">Mis-credited deposits</h3>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="rounded-full border border-white/15 px-3 py-1 text-xs disabled:opacity-50"
        >
          {loading ? "Scanning…" : "Rescan"}
        </button>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-white/50">
        Deposits where the settlement symbol was paired with the origin amount —
        e.g. 0.4 SOL credited as 0.4 USDC. Correcting one moves real balance and
        writes an audit entry.
      </p>

      {report?.error && <p className="mt-3 text-xs text-red-400">{report.error}</p>}

      {msg && <p className="mt-3 text-xs text-amber-300">{msg}</p>}

      {report && !report.error && outstanding.length === 0 && (
        <p className="mt-4 text-xs text-emerald-400">
          Nothing outstanding — no deposits need correcting.
        </p>
      )}

      {outstanding.length > 0 && (
        <p className="mt-3 text-xs text-white/60">
          {report?.counts?.repairable ?? 0} correctable automatically ·{" "}
          {report?.counts?.manual ?? 0} need an on-chain lookup
        </p>
      )}

      <div className="mt-4 space-y-3">
        {outstanding.map((f) => {
          const needsManual = f.verdict === "NEEDS_MANUAL";
          const entry =
            manual[f.settlementId] ??
            (f.estimate
              ? { asset: f.estimate.asset, amount: String(f.estimate.amount) }
              : { asset: "USDC", amount: "" });

          return (
            <div key={f.settlementId} className="rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">
                    {f.userEmail ?? f.username ?? f.userId ?? "unknown user"}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] break-all text-white/40">
                    {f.externalId}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${
                    needsManual
                      ? "bg-amber-500/15 text-amber-300"
                      : "bg-red-500/15 text-red-300"
                  }`}
                >
                  {needsManual ? "needs lookup" : "correctable"}
                </span>
              </div>

              <dl className="mt-3 space-y-1 text-xs">
                {f.originAsset && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-white/40">They sent</dt>
                    <dd className="text-white/80">
                      {f.originAmount ?? "?"} {f.originAsset}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <dt className="text-white/40">Credited</dt>
                  <dd className="text-red-300">
                    {f.creditedAmount} {f.creditedAsset}
                  </dd>
                </div>
                {f.trueSettlementAmount !== null && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-white/40">Actually settled</dt>
                    <dd className="text-emerald-300">
                      {f.trueSettlementAmount} {f.trueSettlementAsset}
                    </dd>
                  </div>
                )}
              </dl>

              {needsManual && (
                <div className="mt-3">
                  {f.estimate ? (
                    <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-2.5">
                      <p className="text-[10px] text-amber-300">
                        Estimated {f.estimate.amount} {f.estimate.asset}
                      </p>
                      <p className="mt-1 text-[10px] leading-relaxed text-white/45">
                        {f.originAmount} {f.originAsset} at $
                        {f.estimate.unitPriceUsd.toLocaleString(undefined, {
                          maximumFractionDigits: 2,
                        })}{" "}
                        each, less the {(f.estimate.feeRate * 100).toFixed(2)}% provider fee.
                        Pre-filled below — {f.estimate.caveat.toLowerCase()}
                      </p>
                    </div>
                  ) : (
                    <p className="text-[10px] text-white/40">
                      The provider sent no settled amount and no price was available.
                      Look this transfer up on the explorer and enter what actually
                      arrived in treasury.
                    </p>
                  )}
                  <div className="mt-2 flex gap-2">
                    <input
                      value={entry.asset}
                      onChange={(e) =>
                        setManual({ ...manual, [f.settlementId]: { ...entry, asset: e.target.value } })
                      }
                      placeholder="USDC"
                      className="w-20 rounded-lg border border-white/15 bg-black/40 px-2 py-1.5 text-xs outline-none focus:border-white/40"
                    />
                    <input
                      value={entry.amount}
                      onChange={(e) =>
                        setManual({ ...manual, [f.settlementId]: { ...entry, amount: e.target.value } })
                      }
                      inputMode="decimal"
                      placeholder="Settled amount"
                      className="flex-1 rounded-lg border border-white/15 bg-black/40 px-2 py-1.5 text-xs outline-none focus:border-white/40"
                    />
                  </div>
                </div>
              )}

              <button
                onClick={() => repair(f)}
                disabled={busyId === f.settlementId}
                className="mt-3 w-full rounded-full bg-white px-3 py-2 text-xs font-medium text-black disabled:opacity-50"
              >
                {busyId === f.settlementId ? "Correcting…" : "Correct this deposit"}
              </button>
            </div>
          );
        })}
      </div>

      {findings.some((f) => f.alreadyRepaired) && (
        <p className="mt-4 text-[10px] text-white/35">
          {findings.filter((f) => f.alreadyRepaired).length} already corrected and hidden.
        </p>
      )}
    </div>
  );
}
