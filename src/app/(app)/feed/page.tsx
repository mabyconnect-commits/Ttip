"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { apiGet, apiPost } from "@/lib/client";
import { TabBar } from "@/components/TabBar";
import { Avatar } from "@/components/ui";
import { formatFiat } from "@/lib/format";

interface FeedItem {
  id: string;
  kind: string;
  actorName: string;
  targetName: string | null;
  amount: number | null;
  currency: string | null;
  note: string | null;
  emoji: string | null;
  reactions: Record<string, number>;
  gradient: string;
  initial: string;
  time: string;
}
interface LeaderRow {
  rank: number;
  username: string;
  gradient: string;
  total: number;
  isYou: boolean;
}

export default function FeedPage() {
  const { state, toast } = useApp();
  const router = useRouter();
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [board, setBoard] = useState<LeaderRow[]>([]);
  const [tab, setTab] = useState("Friends");

  useEffect(() => {
    apiGet<{ feed: FeedItem[]; leaderboard: LeaderRow[] }>("/api/feed")
      .then((d) => { setFeed(d.feed); setBoard(d.leaderboard); })
      .catch(() => {});
  }, []);

  async function react(id: string, emoji: string) {
    setFeed((f) => f.map((it) => (it.id === id ? { ...it, reactions: { ...it.reactions, [emoji]: (it.reactions[emoji] ?? 0) + 1 } } : it)));
    apiPost("/api/feed", { id, emoji }).catch(() => {});
  }

  const you = board.find((b) => b.isYou);
  const ahead = board.find((b) => you && b.rank === you.rank - 1);

  // Filter/sort the feed by the active tab.
  const shownFeed = (() => {
    if (tab === "Top") return [...feed].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
    if (tab === "Lagos 🔥") return feed.filter((it) => it.kind === "tip" || it.kind === "split");
    return feed; // Friends → recent (default order)
  })();

  return (
    <>
      <div className="flex items-center justify-between px-[22px] pt-3.5 pb-3">
        <div className="font-grotesk font-bold text-[22px]">Feed</div>
        <div className="flex gap-2 font-grotesk font-semibold text-[12px]">
          {["Friends", "Lagos 🔥", "Top"].map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-[14px] px-3 py-1.5 ${tab === t ? "bg-white text-[#07080D]" : "border border-white/14 text-white/60"}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* leaderboard strip */}
      <div className="mx-[22px] rounded-2xl px-3.5 py-3 flex items-center gap-2.5" style={{ background: "linear-gradient(90deg,rgba(109,91,255,.15),rgba(61,245,176,.12))", border: "1px solid rgba(109,91,255,.3)" }}>
        <span className="text-lg">👑</span>
        <span className="font-sans text-[12.5px] text-white/80">
          Weekly Ttip League:{" "}
          {you ? (
            <>
              you&apos;re <b className="text-brand-cyan">#{you.rank} of your circle</b>
              {ahead ? <> — {formatFiat(Math.max(0, ahead.total - you.total), state.user.defaultFiat, { decimals: 0 })} more to pass {ahead.username}</> : " — you're on top 🔥"}
            </>
          ) : (
            <>send your first Ttip to enter the league</>
          )}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar px-[22px] py-3.5 flex flex-col gap-2.5">
        {shownFeed.map((it) => (
          <div key={it.id} className="bg-surface border border-white/[.06] rounded-[18px] p-3.5">
            <div className="flex items-center gap-2.5">
              <Avatar gradient={it.gradient} initial={it.initial} size={34} />
              <div className="flex-1 font-sans text-[13px] text-white/85">
                <b>{it.actorName}</b>{" "}
                {it.kind === "tip" && <>ttipped <b>{it.targetName}</b></>}
                {it.kind === "split" && <>split a bill with <b>{it.targetName}</b></>}
                {it.kind === "streak" && <>hit a <b>streak</b></>}
                {it.kind === "swap" && <>swapped crypto</>}
                <span className="text-white/40"> · {it.time}</span>
              </div>
              {it.amount != null && it.kind !== "streak" && (
                <div className="font-grotesk font-bold text-[14px] text-good">{formatFiat(it.amount, it.currency ?? "NGN", { decimals: 0 })}</div>
              )}
              {it.kind === "streak" && <div className="font-grotesk font-bold text-[14px] text-warn">🔥</div>}
            </div>
            {it.note && <div className="font-sans text-[13.5px] mt-2.5 mx-0.5">{it.note}</div>}
            <div className="flex gap-3.5 mt-2.5 font-sans font-medium text-[12px] text-white/45 items-center">
              {Object.entries(it.reactions).map(([e, n]) => (
                <button key={e} onClick={() => react(it.id, e)} className="active:scale-90 transition">
                  {e} {n}
                </button>
              ))}
              <button onClick={() => react(it.id, "🔥")} className="opacity-60">＋</button>
              <button
                onClick={() => {
                  const handle = it.actorName.replace(/^@/, "");
                  router.push(it.kind === "split" ? "/split" : `/ttip?to=${encodeURIComponent(handle)}`);
                }}
                className="ml-auto text-brand-cyan"
              >
                ⚡ {it.kind === "split" ? "Split" : it.kind === "streak" ? "Congratulate" : "Ttip back"}
              </button>
            </div>
          </div>
        ))}
        {shownFeed.length === 0 && <div className="text-center text-white/40 text-[13px] py-10">Nothing here yet.</div>}
      </div>

      <TabBar />
    </>
  );
}
