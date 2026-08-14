"use client";

import { useEffect, useState } from "react";

/**
 * The growth tiles: is Ttip actually working, at a glance.
 *
 * The admin page could tell you what Ttip earned and what was unbacked — the
 * accountant's questions. It could not answer the founder's: how many people
 * opened it today, how many keep coming back, how much moved this week. Those
 * are the numbers you screenshot for a partner.
 *
 * Naira, not dollars, because that is the currency the business is quoted in.
 */

interface Stats {
  fiat?: string;
  users?: {
    total: number;
    newToday: number;
    new7d: number;
    new30d: number;
    recurring: number;
    verified: number;
    withPin: number;
    verifiedPct: number;
  };
  active?: {
    today: number;
    last7d: number;
    last30d: number;
    todayPct: number;
    retention7dPct: number;
    tracking: boolean;
  };
  volume?: {
    allTimeNgn: number;
    allTimeTx: number;
    todayNgn: number;
    todayTx: number;
    last7dNgn: number;
    last7dTx: number;
    last30dNgn: number;
    last30dTx: number;
    avgTxNgn: number;
  };
  flows?: Record<string, { count: number; ngn: number }>;
  excluded?: number;
  error?: string;
}

const n = (v: number | undefined) => (v ?? 0).toLocaleString("en-US");

/** ₦235.1M rather than ₦235,148,922 — a headline has to be readable at a glance. */
function money(v: number | undefined): string {
  const x = v ?? 0;
  if (x >= 1e9) return `₦${(x / 1e9).toFixed(1)}B`;
  if (x >= 1e6) return `₦${(x / 1e6).toFixed(1)}M`;
  if (x >= 1e3) return `₦${(x / 1e3).toFixed(1)}K`;
  return `₦${Math.round(x).toLocaleString("en-US")}`;
}

/** The labels users would recognise, for the per-type breakdown. */
const TYPE_LABEL: Record<string, string> = {
  deposit: "Crypto deposits",
  buy: "Buys",
  swap: "Swaps",
  ttip_out: "Ttips sent",
  ttip_in: "Ttips received",
  withdraw_bank: "Bank withdrawals",
  withdraw_wallet: "Crypto withdrawals",
  bill: "Bills",
  card_fund: "Card top-ups",
  card_spend: "Card spend",
  giftcard: "Gift cards",
};

export function GrowthStats() {
  const [s, setS] = useState<Stats | null>(null);

  useEffect(() => {
    fetch("/api/admin/stats", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { error: r.status === 404 ? "Not an admin account." : `Error ${r.status}` }))
      .then(setS)
      .catch(() => setS({ error: "Couldn't reach the server." }));
  }, []);

  if (!s) {
    return (
      <div className="rounded-2xl bg-surface border border-white/[.08] p-5 text-center text-white/40 text-[13px] mt-4">
        Counting…
      </div>
    );
  }
  if (s.error) return null;

  const flows = Object.entries(s.flows ?? {})
    .filter(([, v]) => v.count > 0)
    .sort((a, b) => b[1].ngn - a[1].ngn)
    .slice(0, 8);

  return (
    <>
      <div className="font-grotesk font-semibold text-[14px] mt-5 mb-2">Growth</div>

      <div className="grid grid-cols-2 gap-2.5">
        <Tile
          label="TOTAL USERS"
          value={n(s.users?.total)}
          sub={`+${n(s.users?.newToday)} today`}
        />
        <Tile
          label="ACTIVE TODAY"
          value={n(s.active?.today)}
          sub="opened the app"
          accent="#3DF5B0"
        />
        <Tile
          label="NEW · 7D"
          value={n(s.users?.new7d)}
          sub={`+${n(s.users?.new30d)} · 30d`}
        />
        <Tile
          label="RECURRING"
          value={n(s.users?.recurring)}
          sub="on a 2+ day streak"
        />
        <Tile
          label="TOTAL VOLUME"
          value={money(s.volume?.allTimeNgn)}
          sub={`${n(s.volume?.allTimeTx)} all time`}
        />
        <Tile
          label="TX VOLUME · 7D"
          value={money(s.volume?.last7dNgn)}
          sub={`${n(s.volume?.last7dTx)} tx`}
        />
      </div>

      {/* The second row: the ones LinkPay doesn't show and you'd want next. */}
      <div className="rounded-2xl bg-surface border border-white/[.08] p-4 mt-2.5">
        <div className="flex flex-col gap-2">
          <Row label="Volume today" value={`${money(s.volume?.todayNgn)} · ${n(s.volume?.todayTx)} tx`} />
          <Row label="Volume · 30d" value={`${money(s.volume?.last30dNgn)} · ${n(s.volume?.last30dTx)} tx`} />
          <Row label="Average transaction" value={money(s.volume?.avgTxNgn)} />
          <div className="h-px bg-white/[.06] my-1" />
          <Row label="Opened the app · 7d" value={n(s.active?.last7d)} />
          <Row label="Opened the app · 30d" value={n(s.active?.last30d)} />
          <Row label="Still opening it (of 30d signups)" value={`${s.active?.retention7dPct ?? 0}%`} />
          <div className="h-px bg-white/[.06] my-1" />
          <Row label="Verified (KYC)" value={`${n(s.users?.verified)} · ${s.users?.verifiedPct ?? 0}%`} />
          <Row label="Has a transaction PIN" value={n(s.users?.withPin)} />
        </div>
        {!s.active?.tracking && (
          <p className="text-white/30 text-[10.5px] leading-[1.45] mt-3">
            App-open tracking started when this shipped, so the &ldquo;opened the app&rdquo; figures only count
            from today forward. They fill in on their own.
          </p>
        )}
      </div>

      {!!flows.length && (
        <div className="rounded-2xl bg-surface border border-white/[.08] p-4 mt-2.5">
          <div className="font-grotesk font-semibold text-[13.5px] mb-3">Where the volume comes from</div>
          <div className="flex flex-col gap-2">
            {flows.map(([type, v]) => (
              <Row
                key={type}
                label={TYPE_LABEL[type] ?? type.replace(/_/g, " ")}
                value={`${money(v.ngn)} · ${n(v.count)}`}
              />
            ))}
          </div>
        </div>
      )}

      {/* A silent exclusion is worse than a wrong number. */}
      {!!s.excluded && (
        <div
          className="rounded-2xl px-4 py-3 mt-2.5 text-[12px] text-white/75"
          style={{ background: "rgba(255,196,61,.07)", border: "1px solid rgba(255,196,61,.25)" }}
        >
          {s.excluded} transaction{s.excluded === 1 ? " was" : "s were"} left out for being too large to be real —
          almost always a mis-credit. Reverse them in Clean-up and these figures become exact.
        </div>
      )}
    </>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: string }) {
  return (
    <div className="rounded-2xl bg-surface border border-white/[.08] p-4">
      <div className="text-white/40 text-[10px] font-grotesk font-semibold tracking-[.08em]">{label}</div>
      <div
        className="font-grotesk font-bold text-[24px] mt-1.5 leading-none break-all"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </div>
      <div className="text-white/35 text-[10.5px] mt-1.5">{sub}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-[12.5px]">
      <span className="text-white/55">{label}</span>
      <b className="font-grotesk font-semibold shrink-0">{value}</b>
    </div>
  );
}
