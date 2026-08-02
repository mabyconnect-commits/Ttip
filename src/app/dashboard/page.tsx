"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useApp } from "@/context/AppContext";
import { apiGet } from "@/lib/client";
import { Ticker } from "@/components/Ticker";
import { Avatar } from "@/components/ui";
import { Icon, type IconName } from "@/components/Icon";
import { formatFiat, formatUsd } from "@/lib/format";

interface Txn {
  id: string; type: string; direction: string; counterparty: string | null; note: string | null; emoji: string | null;
  assetIn: string | null; amountIn: number | null; assetOut: string | null; amountOut: number | null; time: string;
}
interface LeaderRow { rank: number; username: string; gradient: string; total: number; isYou: boolean }

const NAV: { icon: IconName; label: string; href: string; active?: boolean }[] = [
  { icon: "home", label: "Dashboard", href: "/dashboard", active: true },
  { icon: "swap", label: "Swap", href: "/swap" },
  { icon: "zap", label: "Ttip", href: "/ttip" },
  { icon: "activity", label: "Feed", href: "/feed" },
  { icon: "card", label: "Card", href: "/card" },
  { icon: "bills", label: "Bills", href: "/bills" },
];

const CHART = [34, 42, 38, 52, 47, 63, 58, 74, 69, 88];

export default function Dashboard() {
  const { state } = useApp();
  const router = useRouter();
  const { user, portfolio } = state;
  const [txns, setTxns] = useState<Txn[]>([]);
  const [board, setBoard] = useState<LeaderRow[]>([]);

  useEffect(() => {
    apiGet<{ transactions: Txn[] }>("/api/transactions?limit=8").then((d) => setTxns(d.transactions)).catch(() => {});
    apiGet<{ leaderboard: LeaderRow[] }>("/api/feed").then((d) => setBoard(d.leaderboard)).catch(() => {});
  }, []);

  return (
    <div className="min-h-dvh flex bg-ink text-white">
      {/* sidebar */}
      <aside className="w-[220px] border-r border-white/[.07] hidden md:flex flex-col p-5 gap-1">
        <button onClick={() => router.push("/home")} className="flex items-center gap-2.5 px-2 pb-4">
          <Image src="/ttip-logo.png" alt="Ttip" width={32} height={32} className="rounded-[9px]" />
          <span className="font-grotesk font-bold text-lg">Ttip</span>
        </button>
        {NAV.map((n) => (
          <button
            key={n.label}
            onClick={() => router.push(n.href)}
            className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl font-sans text-[13.5px] transition ${n.active ? "bg-brand-cyan/12 text-brand-cyan font-semibold" : "text-white/55 hover:text-white hover:bg-white/5"}`}
          >
            <Icon name={n.icon} size={19} /> {n.label}
          </button>
        ))}
        <div className="flex-1" />
        <div className="rounded-2xl p-3.5 bg-surface border border-white/[.06]">
          <div className="font-grotesk font-semibold text-[13px]">{user.streakDays}-day streak</div>
          <div className="font-sans text-[11.5px] text-white/55 mt-1">Ttip someone today to keep it going</div>
        </div>
      </aside>

      {/* main */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* topbar */}
        <div className="flex items-center gap-5 px-6 py-3.5 border-b border-white/[.07]">
          <div className="flex-1 min-w-0">
            <Ticker />
          </div>
          <button onClick={() => router.push("/ttip")} className="font-grotesk font-semibold text-[12px] rounded-[14px] px-3.5 py-2 bg-good text-ink">
            + New Ttip
          </button>
          <button onClick={() => router.push("/profile")}>
            <Avatar gradient={user.avatarGradient} initial={user.initial} size={34} />
          </button>
        </div>

        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4 p-6 overflow-auto">
          {/* left column */}
          <div className="flex flex-col gap-4 min-w-0">
            <div className="rounded-[22px] p-[22px] bg-surface border border-white/[.08]">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-sans text-[12px] text-white/50">Total balance</div>
                  <div className="font-grotesk font-bold text-[42px] leading-[1.1] tracking-[-1.4px] mt-1.5">{formatFiat(portfolio.totalFiat, portfolio.fiat, { decimals: 0 })}</div>
                  <div className="font-sans text-[12.5px] text-good mt-1.5">≈ {formatUsd(portfolio.totalUsd)}</div>
                </div>
                <div className="flex gap-2 font-grotesk font-semibold text-[11.5px]">
                  {["1D", "1W", "1M", "1Y"].map((r, i) => (
                    <span key={r} className={`rounded-[11px] px-2.5 py-1.5 ${i === 1 ? "bg-white text-[#07080D]" : "bg-white/10"}`}>{r}</span>
                  ))}
                </div>
              </div>
              <div className="mt-4 h-[120px] flex items-end gap-1.5">
                {CHART.map((h, i) => (
                  <div key={i} className="flex-1 rounded-t" style={{ height: `${h}%`, background: `linear-gradient(180deg,${i > 6 ? "rgba(61,245,176,.7)" : "rgba(42,200,255,.5)"},rgba(42,200,255,.05))` }} />
                ))}
              </div>
            </div>

            <div className="bg-surface border border-white/[.06] rounded-[20px] p-[18px] flex-1">
              <div className="font-grotesk font-semibold text-[15px] mb-3">Recent activity</div>
              <div className="flex flex-col gap-2.5 font-sans text-[13px]">
                {txns.map((t) => (
                  <div key={t.id} className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "rgba(42,200,255,.12)" }}>{t.emoji ?? "•"}</span>
                    <span className="flex-1 truncate">{t.note ?? t.type}{t.counterparty ? <span className="text-white/40"> · {t.counterparty}</span> : null}</span>
                    <b className="font-grotesk" style={{ color: t.direction === "in" ? "#3DF5B0" : "#FF7A8A" }}>
                      {t.direction === "in" ? "+" : "−"}
                      {t.direction === "in"
                        ? formatFiat(t.amountOut ?? 0, t.assetOut ?? portfolio.fiat, { decimals: 0 })
                        : `${(t.amountIn ?? 0).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${t.assetIn ?? ""}`}
                    </b>
                  </div>
                ))}
                {txns.length === 0 && <div className="text-white/40 text-center py-4">No activity yet.</div>}
              </div>
            </div>
          </div>

          {/* right rail */}
          <div className="flex flex-col gap-4 min-w-0">
            <div className="bg-surface border border-white/[.06] rounded-[20px] p-[18px]">
              <div className="font-grotesk font-semibold text-[15px] mb-3">Quick actions</div>
              <div className="grid grid-cols-2 gap-2.5">
                {([["swap", "Swap", "/swap"], ["zap", "Ttip", "/ttip"], ["arrowDown", "Add money", "/deposit"], ["gift", "Split", "/split"]] as [IconName, string, string][]).map(([i, l, h]) => (
                  <button key={l} onClick={() => router.push(h)} className="bg-surface2 rounded-2xl py-4 flex flex-col items-center gap-1.5 hover:bg-white/5 transition text-white/85">
                    <Icon name={i} size={22} />
                    <span className="text-[12px] text-white/70">{l}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-surface border border-white/[.06] rounded-[20px] p-[18px] flex-1">
              <div className="font-grotesk font-semibold text-[15px] mb-3">Ttip League · this week</div>
              <div className="flex flex-col gap-2.5 font-sans text-[13px]">
                {board.slice(0, 6).map((r) => (
                  <div key={r.rank} className={`flex items-center gap-2.5 ${r.isYou ? "bg-brand-cyan/[.08] rounded-xl px-2 -mx-2 py-1.5" : ""}`}>
                    <b className="w-5 font-grotesk" style={{ color: r.rank === 1 ? "#FFC85B" : r.isYou ? "#2AC8FF" : "rgba(255,255,255,.5)" }}>{r.rank}</b>
                    <Avatar gradient={r.gradient} initial={r.username.replace(/^@/, "").charAt(0).toUpperCase()} size={28} />
                    <span className="flex-1 truncate">{r.isYou ? "you" : r.username}</span>
                    <b className="font-grotesk">{formatFiat(r.total, portfolio.fiat, { decimals: 0 })}</b>
                  </div>
                ))}
                {board.length === 0 && <div className="text-white/40 text-center py-4">Send a Ttip to join the league.</div>}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
