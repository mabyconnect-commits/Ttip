"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/client";
import { BackHeader } from "@/components/ui";
import { formatFiat } from "@/lib/format";

interface Row { rank: number; name: string; referrals: number; earned: number; isYou: boolean }
interface Board { period: string; leaders: Row[]; you: Row }

const PERIODS = [
  { id: "all", label: "All time" },
  { id: "month", label: "This month" },
  { id: "week", label: "This week" },
];

const MEDAL = ["#FFC85B", "#C7CCD6", "#E08A5B"]; // gold, silver, bronze

export default function LeaderboardPage() {
  const [period, setPeriod] = useState("all");
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiGet<Board>(`/api/referrals/leaderboard?period=${period}`)
      .then(setBoard)
      .catch(() => setBoard(null))
      .finally(() => setLoading(false));
  }, [period]);

  const top3 = board?.leaders.slice(0, 3) ?? [];
  const rest = board?.leaders.slice(3) ?? [];
  const podiumOrder = [top3[1], top3[0], top3[2]]; // 2nd, 1st, 3rd
  const heights = [96, 124, 78];

  return (
    <div className="flex flex-col flex-1 px-[22px] min-h-0">
      <BackHeader title="Leaderboard" />

      {/* period tabs */}
      <div className="flex gap-2 mt-1">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPeriod(p.id)}
            className={`flex-1 h-9 rounded-full text-[12.5px] font-grotesk font-semibold transition ${period === p.id ? "bg-white text-[#07080D]" : "border border-white/12 text-white/60"}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar pt-2 pb-24">
        {loading && <div className="text-center text-white/40 text-[13px] py-16">Loading…</div>}

        {!loading && (
          <>
            {/* podium */}
            {top3.length > 0 && (
              <div className="flex items-end justify-center gap-2.5 mt-4 mb-6">
                {podiumOrder.map((r, i) =>
                  r ? (
                    <div key={r.rank} className="flex flex-col items-center flex-1 max-w-[110px]">
                      <div className="w-11 h-11 rounded-full flex items-center justify-center font-grotesk font-bold text-[16px] text-ink mb-1.5" style={{ background: MEDAL[r.rank - 1] }}>
                        {r.rank}
                      </div>
                      <div className="font-grotesk font-semibold text-[13px] truncate max-w-full">{r.name}</div>
                      <div className="font-grotesk font-bold text-[12px] text-good mt-0.5">{formatFiat(r.earned, "NGN", { decimals: 0 })}</div>
                      <div
                        className="w-full rounded-t-xl mt-2 flex items-start justify-center pt-1.5 font-grotesk font-bold text-[18px] text-white/80"
                        style={{ height: heights[i], background: "linear-gradient(180deg,rgba(42,200,255,.22),rgba(42,200,255,.05))", border: "1px solid rgb(var(--fg) / .10)" }}
                      >
                        {r.rank}
                      </div>
                    </div>
                  ) : (
                    <div key={i} className="flex-1 max-w-[110px]" />
                  ),
                )}
              </div>
            )}

            {/* ranked list */}
            <div className="flex flex-col gap-1.5">
              {rest.map((r) => (
                <Line key={r.rank} r={r} />
              ))}
              {board && board.leaders.length === 0 && (
                <div className="text-center text-white/40 text-[13px] py-14">
                  No referral earnings yet.<br />Invite friends and climb the board.
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* your rank — pinned */}
      {board?.you && (
        <div className="pb-5 pt-2">
          <div className="flex items-center gap-3 rounded-2xl px-4 py-3.5 bg-brand-cyan/[.08] border border-brand-cyan/25">
            <span className="w-9 h-9 rounded-full border border-brand-cyan/40 flex items-center justify-center font-grotesk font-bold text-[13px] text-brand-cyan shrink-0">
              {board.you.rank > 0 ? board.you.rank : "—"}
            </span>
            <div className="flex-1">
              <div className="font-grotesk font-semibold text-[14px]">You</div>
              <div className="text-white/45 text-[11.5px]">{board.you.referrals} referrals</div>
            </div>
            <div className="font-grotesk font-bold text-[14px]">{formatFiat(board.you.earned, "NGN", { decimals: 2 })}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function Line({ r }: { r: Row }) {
  return (
    <div className={`flex items-center gap-3 rounded-2xl px-4 py-3 border ${r.isYou ? "bg-brand-cyan/[.08] border-brand-cyan/25" : "bg-surface border-white/[.06]"}`}>
      <span className="w-9 h-9 rounded-full bg-surface2 flex items-center justify-center font-grotesk font-bold text-[13px] text-white/70 shrink-0">{r.rank}</span>
      <div className="flex-1 min-w-0">
        <div className="font-grotesk font-semibold text-[14px] truncate">{r.name}{r.isYou ? " (you)" : ""}</div>
        <div className="text-white/45 text-[11.5px]">{r.referrals} referrals</div>
      </div>
      <div className="font-grotesk font-bold text-[13.5px]">{formatFiat(r.earned, "NGN", { decimals: 0 })}</div>
    </div>
  );
}
