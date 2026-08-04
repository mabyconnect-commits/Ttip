"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { apiGet } from "@/lib/client";
import { BackHeader } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { QR } from "@/components/QR";
import { formatFiat } from "@/lib/format";

interface RefData {
  code: string;
  link: string;
  earned: number;
  balance: number;
  count: number;
  verifiedCount: number;
  earnPct: number;
  depositBonus: number;
  depositBonusMinUsd: number;
  depositBonusHoldHours: number;
  thisWeek: number;
  thisMonth: number;
  earnings: { name: string; amount: number; note: string; time: string }[];
  referrals: { name: string; bonus: number; time: string }[];
}

export default function ReferralsPage() {
  const { state, action, toast } = useApp();
  const router = useRouter();
  const [data, setData] = useState<RefData | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const fiat = state.user.defaultFiat;
  const pct = Math.round((data?.earnPct ?? 0.25) * 100);
  const bonus = data?.depositBonus ?? 500;
  const balance = data?.balance ?? 0;

  function load() {
    apiGet<RefData>("/api/referrals").then(setData).catch(() => {});
  }
  useEffect(load, []);

  async function withdraw() {
    if (balance <= 0) return toast("No referral earnings to withdraw yet", "info");
    setWithdrawing(true);
    try {
      await action("/api/referrals/withdraw", {});
      load();
      toast("Referral earnings added to your balance 🎉", "good");
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setWithdrawing(false);
    }
  }

  function copy(text: string) {
    navigator.clipboard?.writeText(text);
    toast("Invite link copied", "good");
  }
  function share() {
    if (data && navigator.share) navigator.share({ title: "Join me on Ttip", text: `Join Ttip and get ${formatFiat(bonus, "NGN", { decimals: 0 })} when your first deposit of $${data?.depositBonusMinUsd ?? 10} or more stays ${data?.depositBonusHoldHours ?? 72}h`, url: data.link }).catch(() => {});
    else if (data) copy(data.link);
  }

  return (
    <div className="flex flex-col flex-1 px-[22px] min-h-0">
      <BackHeader title="Invite & earn" />
      <div className="flex-1 overflow-y-auto no-scrollbar pt-2">
        <div className="rounded-3xl p-6 bg-surface border border-white/[.06] text-center">
          <div className="w-14 h-14 mx-auto rounded-full flex items-center justify-center mb-3" style={{ background: "rgba(61,245,176,.10)", border: "1px solid rgba(61,245,176,.28)" }}>
            <Icon name="gift" size={24} className="text-good" />
          </div>
          <div className="font-grotesk font-bold text-[22px] tracking-[-0.5px]">Refer & earn {pct}%</div>
          <div className="font-sans text-[13px] text-white/55 mt-1.5 max-w-[280px] mx-auto">
            Earn {pct}% of the swap and crypto-withdrawal fees your friends pay — for life. They get {formatFiat(bonus, "NGN", { decimals: 0 })} once their first deposit of ${data?.depositBonusMinUsd ?? 10} or more stays {data?.depositBonusHoldHours ?? 72}h on Ttip.
          </div>
        </div>

        {/* referral balance */}
        {/* Keeps its dark brand gradient in both themes, so `on-dark` holds the
            text light instead of letting light mode turn it near-black. */}
        <div className="on-dark rounded-3xl p-5 mt-3 text-center relative overflow-hidden" style={{ background: "linear-gradient(135deg,#0E1330,#171A2E)", border: "1px solid rgba(255,255,255,.08)" }}>
          <div className="text-[12px] text-white/50">Referral balance</div>
          <div className="font-grotesk font-bold text-[30px] mt-1 tracking-[-0.5px]">{formatFiat(data?.balance ?? 0, "NGN", { decimals: 2 })}</div>
          <div className="grid grid-cols-3 gap-2 mt-4">
            {[["All time", data?.earned], ["This week", data?.thisWeek], ["This month", data?.thisMonth]].map(([label, val]) => (
              <div key={label as string} className="bg-white/[.04] rounded-2xl py-2.5">
                <div className="text-[10.5px] text-white/45">{label as string}</div>
                <div className="font-grotesk font-bold text-[14px] mt-0.5">{formatFiat((val as number) ?? 0, "NGN", { decimals: 0 })}</div>
              </div>
            ))}
          </div>
          <button
            onClick={withdraw}
            disabled={withdrawing || balance <= 0}
            className="w-full mt-4 h-12 rounded-2xl bg-brand-cyan text-ink font-grotesk font-bold text-[14px] disabled:opacity-40 active:scale-[.99]"
          >
            {withdrawing ? "Withdrawing…" : "Withdraw to wallet"}
          </button>
        </div>

        {/* leaderboard */}
        <button
          onClick={() => router.push("/referrals/leaderboard")}
          className="w-full mt-3 bg-surface border border-white/[.08] rounded-[22px] px-4 py-3.5 flex items-center gap-3 active:scale-[.99]"
        >
          <span className="w-10 h-10 rounded-full bg-warn/[.12] border border-warn/25 flex items-center justify-center text-warn shrink-0"><Icon name="activity" size={18} /></span>
          <div className="flex-1 text-left">
            <div className="font-grotesk font-semibold text-[15px]">Leaderboard</div>
            <div className="text-white/45 text-[12px]">See where you rank among top referrers</div>
          </div>
          <Icon name="chevronRight" size={16} className="text-white/30" />
        </button>

        <div className="grid grid-cols-2 gap-2.5 mt-3">
          <div className="bg-surface border border-white/[.06] rounded-[18px] p-4">
            <div className="text-[11px] text-white/45">Total earned</div>
            <div className="font-grotesk font-bold text-[22px] text-good mt-1">{formatFiat(data?.earned ?? 0, "NGN", { decimals: 0 })}</div>
          </div>
          <div className="bg-surface border border-white/[.06] rounded-[18px] p-4">
            <div className="text-[11px] text-white/45">Friends joined</div>
            <div className="font-grotesk font-bold text-[22px] mt-1">{data?.count ?? 0}</div>
            {/* Verified friends are the ones who can actually trade — so they're
                the only ones who ever earn you anything. */}
            <div className="text-[11px] text-good mt-0.5">{data?.verifiedCount ?? 0} verified</div>
          </div>
        </div>

        <div className="bg-surface border border-white/[.08] rounded-[22px] p-5 mt-3 flex flex-col items-center">
          {data && <QR value={data.link} size={150} />}
          <div className="font-grotesk font-semibold text-[14px] mt-4">Your invite code</div>
          <div className="font-grotesk font-bold text-[22px] tracking-[3px] text-brand-cyan mt-1">{data?.code ?? "…"}</div>
          <div className="flex gap-2.5 mt-4 w-full">
            <button onClick={() => data && copy(data.link)} className="flex-1 bg-good text-ink rounded-full py-3 font-grotesk font-semibold text-[13px]">Copy link</button>
            <button onClick={share} className="flex-1 rounded-full py-3 font-grotesk font-semibold text-[13px] border border-white/14">Share</button>
          </div>
        </div>

        {data && data.earnings.length > 0 && (
          <div className="mt-4 mb-6">
            <div className="font-grotesk font-semibold text-[13.5px] mb-2">Earnings</div>
            <div className="flex flex-col gap-2">
              {data.earnings.map((e, i) => (
                <div key={i} className="flex items-center gap-3 bg-surface border border-white/[.06] rounded-[14px] px-3.5 py-3">
                  <span className="w-8 h-8 rounded-full bg-surface2 flex items-center justify-center text-good shrink-0"><Icon name="gift" size={15} /></span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] truncate">{e.name}</div>
                    <div className="text-white/40 text-[11px] truncate">{e.note} · {e.time}</div>
                  </div>
                  <div className="font-grotesk font-bold text-[13px] text-good shrink-0">+{formatFiat(e.amount, "NGN", { decimals: 2 })}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
