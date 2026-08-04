"use client";

import { useEffect, useState } from "react";

/**
 * Total users, and the funnel underneath it.
 *
 * The headline number on its own is the least useful one — it counts everyone
 * who ever typed in an email. Verified, funded and active are what tell you
 * whether the platform is working.
 */

interface Stats {
  total?: number;
  signups?: { today: number; last7d: number; last30d: number };
  funnel?: {
    verified: number;
    verifiedPct: number;
    pendingVerification: number;
    funded: number;
    fundedPct: number;
    withNairaAccount: number;
    withPin: number;
  };
  active?: { last7d: number; last30d: number; last7dPct: number };
  error?: string;
}

const n = (v: number | undefined) => (v ?? 0).toLocaleString("en-US");

export function UsersCard() {
  const [s, setS] = useState<Stats | null>(null);

  useEffect(() => {
    fetch("/api/admin/users", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { error: r.status === 404 ? "Not an admin account." : `Error ${r.status}` }))
      .then(setS)
      .catch(() => setS({ error: "Couldn't reach the server." }));
  }, []);

  if (!s || s.error) return null;

  return (
    <>
      <div className="font-grotesk font-semibold text-[14px] mt-6 mb-2">Users</div>

      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-2xl bg-surface border border-white/[.08] p-4">
          <div className="text-white/45 text-[11.5px]">Total users</div>
          <div className="font-grotesk font-bold text-[26px] mt-1">{n(s.total)}</div>
          <div className="text-white/35 text-[10.5px] mt-0.5">
            +{n(s.signups?.today)} today · +{n(s.signups?.last7d)} this week
          </div>
        </div>
        <div className="rounded-2xl bg-surface border border-good/25 p-4">
          <div className="text-white/45 text-[11.5px]">Funded</div>
          <div className="font-grotesk font-bold text-[26px] mt-1 text-good">{n(s.funnel?.funded)}</div>
          {/* The one that matters: real money actually arrived. */}
          <div className="text-white/35 text-[10.5px] mt-0.5">{s.funnel?.fundedPct ?? 0}% of signups</div>
        </div>
      </div>

      <div className="rounded-2xl bg-surface border border-white/[.08] p-4 mt-2.5">
        <div className="flex flex-col gap-2">
          <Row label="Verified (KYC)" value={`${n(s.funnel?.verified)} · ${s.funnel?.verifiedPct ?? 0}%`} />
          {(s.funnel?.pendingVerification ?? 0) > 0 && (
            <Row label="Awaiting verification" value={n(s.funnel?.pendingVerification)} warn />
          )}
          <Row label="Has a naira account" value={n(s.funnel?.withNairaAccount)} />
          <Row label="Has a transaction PIN" value={n(s.funnel?.withPin)} />
          <div className="h-px bg-white/[.06] my-1" />
          <Row label="Active last 7 days" value={`${n(s.active?.last7d)} · ${s.active?.last7dPct ?? 0}%`} />
          <Row label="Active last 30 days" value={n(s.active?.last30d)} />
          <Row label="New in 30 days" value={n(s.signups?.last30d)} />
        </div>
        <p className="text-white/30 text-[10.5px] leading-[1.45] mt-3">
          Funded counts users a payment provider actually settled money for — never a balance, which the
          platform can create on its own.
        </p>
      </div>
    </>
  );
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex justify-between text-[12.5px]">
      <span className="text-white/55">{label}</span>
      <b className={`font-grotesk font-semibold ${warn ? "text-warn" : ""}`}>{value}</b>
    </div>
  );
}
