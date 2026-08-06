"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/Icon";

/**
 * The desk an operator works from when a payout is waiting on naira.
 *
 * Everything needed to finish one, in one place: what's held, how long is left
 * on each, the USDC already sent to the exchange (with the on-chain link, so it
 * can be verified rather than taken on trust), and what the float holds now.
 *
 * The countdown is the point. A held payout fails and refunds when it runs out,
 * automatically — so the number on screen is not decoration, it's how long the
 * operator actually has.
 */

interface Hold {
  reference: string;
  fiat: string;
  amountFiat: number;
  shortfallFiat: number;
  accountNumber: string;
  bankName: string | null;
  accountName: string | null;
  jobId: string | null;
  secondsLeft: number;
}

interface TopUp {
  id: string;
  status: string;
  fiat: string;
  targetFiat: number;
  asset: string;
  amountAsset: number;
  depositAddress: string | null;
  fundingTx: string | null;
  fundingTxUrl: string | null;
  reference: string | null;
  error: string | null;
}

interface Desk {
  holdWindowMinutes?: number;
  bufferPct?: number;
  venue?: { name: string; coin: string; chain: string } | null;
  floats?: Record<string, number>;
  treasuryUsdc?: number;
  venueBalance?: number | null;
  holds?: Hold[];
  topups?: TopUp[];
  error?: string;
}

const money = (n: number, fiat: string) =>
  `${fiat === "NGN" ? "₦" : fiat + " "}${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

function clock(s: number): string {
  if (s <= 0) return "expired";
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function PayoutDesk() {
  const [desk, setDesk] = useState<Desk | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [raised, setRaised] = useState<Record<string, string>>({});
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/payouts", { cache: "no-store" });
      setDesk(r.ok ? await r.json() : { error: r.status === 404 ? "Not an admin account." : `Error ${r.status}` });
    } catch {
      setDesk({ error: "Couldn't reach the server." });
    }
  }, []);

  useEffect(() => {
    load();
    // Refetch often: the deadline is real and an operator working from a stale
    // list is one who resolves something that already refunded.
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  // Local ticking, so the countdown moves between fetches.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  async function act(body: Record<string, unknown>, key: string) {
    setBusy(key);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      setMsg(j.message ?? j.error ?? "Done.");
      await load();
    } catch {
      setMsg("Request failed.");
    } finally {
      setBusy(null);
    }
  }

  if (desk?.error || !desk) return null;

  const holds = desk.holds ?? [];
  const topups = desk.topups ?? [];

  return (
    <>
      {/* Always on screen, not only when something is stuck. Setting the venue
          up means putting two secrets into Vercel and hoping; the first time
          anyone finds out whether they were right must not be the first time a
          real payout is short of naira. */}
      <div className="font-grotesk font-semibold text-[14px] mt-6 mb-2">
        Float &amp; payouts
        {holds.length > 0 && <span className="ml-2 text-warn">{holds.length} waiting</span>}
      </div>

      <div className="rounded-2xl bg-surface border border-white/[.08] p-3.5 mb-2.5">
        <div className="text-[12px] flex flex-wrap gap-x-5 gap-y-1.5">
          {Object.entries(desk.floats ?? {}).map(([fiat, v]) => (
            <span key={fiat} className="text-white/50">
              {fiat} float <b className="text-white font-grotesk">{money(v, fiat)}</b>
            </span>
          ))}
          <span className="text-white/50">
            Treasury USDC <b className="text-white font-grotesk">{(desk.treasuryUsdc ?? 0).toFixed(2)}</b>
          </span>
          <span className="text-white/50">
            Venue{" "}
            <b className="text-white font-grotesk">
              {desk.venue ? `${desk.venue.name} · ${desk.venue.coin} on ${desk.venue.chain}` : "not configured"}
            </b>
          </span>
          {desk.venueBalance != null && (
            <span className="text-white/50">
              On venue <b className="text-white font-grotesk">{desk.venueBalance.toFixed(2)}</b>
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2.5 mt-3">
          <button
            disabled={busy === "ping"}
            onClick={() => act({ action: "ping" }, "ping")}
            className="rounded-2xl border border-white/12 py-3 font-grotesk font-semibold text-[12.5px] active:scale-[.99] disabled:opacity-50"
          >
            Test venue
          </button>
          <button
            disabled={busy === "treasury"}
            onClick={() => {
              const v = prompt("How much USDC does the treasury wallet actually hold?");
              if (v && Number(v) >= 0) act({ action: "setTreasury", symbol: "USDC", amount: Number(v) }, "treasury");
            }}
            className="rounded-2xl border border-white/12 py-3 font-grotesk font-semibold text-[12.5px] active:scale-[.99] disabled:opacity-50"
          >
            Record treasury USDC
          </button>
        </div>
      </div>

      {msg && <div className="text-[12px] text-white/70 mb-2">{msg}</div>}

      {holds.map((h) => {
        // Count down locally between fetches; `tick` is what drives the redraw.
        const left = Math.max(0, h.secondsLeft - (tick % 15));
        return (
          <div key={h.reference} className="rounded-2xl bg-surface border border-warn/30 p-4 mb-2.5">
            <div className="flex justify-between items-baseline gap-2">
              <span className="font-grotesk font-bold text-[16px]">{money(h.amountFiat, h.fiat)}</span>
              <span className={`font-grotesk font-semibold text-[13px] ${left < 300 ? "text-bad" : "text-warn"}`}>
                {clock(left)}
              </span>
            </div>
            <div className="text-white/60 text-[12.5px] mt-1">
              {h.accountName ?? "—"} · {h.accountNumber}
              {h.bankName ? ` · ${h.bankName}` : ""}
            </div>
            <div className="text-white/40 text-[11.5px] mt-0.5">
              Short {money(h.shortfallFiat, h.fiat)} of float · ref {h.reference}
            </div>
            <div className="grid grid-cols-2 gap-2.5 mt-3">
              <button
                disabled={busy === h.reference}
                onClick={() => act({ action: "sent", reference: h.reference }, h.reference)}
                className="rounded-2xl bg-good/[.14] border border-good/30 py-3 font-grotesk font-semibold text-[13px] text-good active:scale-[.99] disabled:opacity-50"
              >
                I&apos;ve sent it
              </button>
              <button
                disabled={busy === h.reference}
                onClick={() => {
                  if (confirm(`Fail ${money(h.amountFiat, h.fiat)} and refund it now?`)) {
                    act({ action: "fail", reference: h.reference }, h.reference);
                  }
                }}
                className="rounded-2xl border border-bad/30 py-3 font-grotesk font-semibold text-[13px] text-bad active:scale-[.99] disabled:opacity-50"
              >
                Fail &amp; refund
              </button>
            </div>
          </div>
        );
      })}

      {topups.map((j) => (
        <div key={j.id} className="rounded-2xl bg-surface border border-white/[.08] p-4 mb-2.5">
          <div className="flex justify-between items-baseline gap-2">
            <span className="font-grotesk font-semibold text-[13.5px]">
              Top-up · {j.amountAsset.toFixed(2)} {j.asset}
            </span>
            <span className="text-[11.5px] text-white/45">{j.status}</span>
          </div>
          <div className="text-white/50 text-[12px] mt-1">
            Raising {money(j.targetFiat, j.fiat)} — sell it and enter what actually landed.
          </div>
          {j.error && <div className="text-bad text-[11.5px] mt-1 leading-snug">{j.error}</div>}
          {j.fundingTxUrl && (
            <a
              href={j.fundingTxUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-brand-cyan text-[12px] mt-1.5"
            >
              View the transfer on-chain <Icon name="share" size={13} />
            </a>
          )}
          <div className="flex gap-2.5 mt-3">
            <input
              value={raised[j.id] ?? ""}
              onChange={(e) => setRaised({ ...raised, [j.id]: e.target.value.replace(/[^0-9.]/g, "") })}
              inputMode="decimal"
              placeholder={`${j.fiat} that landed`}
              className="flex-1 min-w-0 bg-surface2 border border-white/10 rounded-2xl px-3.5 py-3 text-[13px] outline-none"
            />
            <button
              disabled={busy === j.id || !raised[j.id]}
              onClick={() => act({ action: "toppedUp", jobId: j.id, raisedFiat: Number(raised[j.id]) }, j.id)}
              className="rounded-2xl bg-good/[.14] border border-good/30 px-4 font-grotesk font-semibold text-[13px] text-good active:scale-[.99] disabled:opacity-40"
            >
              Credit float
            </button>
          </div>
        </div>
      ))}

      {(holds.length > 0 || topups.length > 0) && (
      <p className="text-white/45 text-[11px] mb-2 leading-[1.5]">
        The user&apos;s crypto is already debited on each of these — only our {holds[0]?.fiat ?? "NGN"} float is short.
        When the clock runs out the transfer fails on its own and every funding leg is refunded, so nothing sits here
        indefinitely. Selling on {desk.venue?.name ?? "the exchange"} is the manual step; the {desk.venue?.coin ?? "USDC"}{" "}
        is sent automatically the moment a payout is held.
      </p>
      )}
    </>
  );
}
