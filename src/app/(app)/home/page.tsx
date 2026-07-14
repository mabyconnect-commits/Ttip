"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { TabBar } from "@/components/TabBar";
import { Ticker } from "@/components/Ticker";
import { AssetIcon } from "@/components/AssetIcon";
import { Avatar, Sheet, grad } from "@/components/ui";
import { Icon, type IconName } from "@/components/Icon";
import { formatFiat, formatUsd, formatCrypto } from "@/lib/format";
import { FIATS } from "@/lib/constants";

export default function HomePage() {
  const { state, action, toast } = useApp();
  const router = useRouter();
  const { user, portfolio } = state;
  const [fiatOpen, setFiatOpen] = useState(false);

  const crypto = portfolio.assets.filter((a) => a.kind === "crypto" && a.amount > 0);
  const shown = crypto.length ? crypto : portfolio.assets.filter((a) => a.kind === "crypto").slice(0, 3);

  async function setFiat(code: string) {
    setFiatOpen(false);
    try {
      await action("/api/profile", { defaultFiat: code }, "PATCH");
      toast(`Switched to ${code}`, "good");
    } catch (e: any) {
      toast(e.message, "bad");
    }
  }

  const [whole, cents] = formatFiat(portfolio.totalFiat, portfolio.fiat).split(".");

  return (
    <>
      {/* header */}
      <div className="flex items-center justify-between px-[22px] pt-3 pb-2">
        <button className="flex items-center gap-2.5" onClick={() => router.push("/profile")}>
          <Avatar gradient={user.avatarGradient} initial={user.initial} size={38} />
          <div className="text-left">
            <div className="font-grotesk font-semibold text-[14px]">Hey {user.name.split(" ")[0]} 👋</div>
            <div className="font-sans text-[11px] text-good">
              @{user.username} · 🔥 {user.streakDays}-day streak
            </div>
          </div>
        </button>
        <div className="flex gap-2">
          <button onClick={() => toast("No new notifications", "info")} className="w-9 h-9 rounded-[18px] border border-white/12 flex items-center justify-center text-white/80">
            <Icon name="bell" size={17} />
          </button>
          <button onClick={() => router.push("/referrals")} className="w-9 h-9 rounded-[18px] border border-white/12 flex items-center justify-center text-white/80">
            <Icon name="gift" size={17} />
          </button>
        </div>
      </div>

      <div className="px-[22px]">
        <Ticker />
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar pb-4">
        {/* balance card */}
        <div className="mx-5 mt-4 rounded-[24px] p-[22px] border border-white/[.08] relative overflow-hidden" style={{ background: "linear-gradient(135deg,#151B33 0%,#0B1B2A 55%,#0B2420 100%)" }}>
          <div className="absolute w-[180px] h-[180px] rounded-full" style={{ right: -40, bottom: -60, background: "radial-gradient(circle,rgba(61,245,176,.18),transparent 70%)" }} />
          <div className="flex justify-between items-center relative">
            <div className="font-sans text-[12px] text-white/50">Total balance</div>
            <button onClick={() => setFiatOpen(true)} className="font-grotesk font-semibold text-[11px] text-brand-cyan border border-brand-cyan/35 rounded-xl px-[9px] py-[3px]">
              {portfolio.fiat} ▾
            </button>
          </div>
          <div className="font-grotesk font-bold text-[38px] leading-[1.1] mt-2 tracking-[-1px] relative">
            {whole}
            <span className="text-[20px] text-white/40">.{cents ?? "00"}</span>
          </div>
          <div className="font-sans text-[12px] text-good mt-1.5 relative">≈ {formatUsd(portfolio.totalUsd)}</div>
        </div>

        {/* add money / send */}
        <div className="grid grid-cols-2 gap-2.5 px-5 mt-4">
          <button onClick={() => router.push("/deposit")} className="grad-bg h-[46px] rounded-[23px] flex items-center justify-center gap-1.5 font-grotesk font-semibold text-[14px] text-[#04121A] active:scale-[.98]">
            <Icon name="arrowDown" size={17} strokeWidth={2.4} /> Add money
          </button>
          <button onClick={() => router.push("/send-out")} className="h-[46px] rounded-[23px] border border-white/14 flex items-center justify-center gap-1.5 font-grotesk font-semibold text-[14px] active:scale-[.98]">
            <Icon name="arrowUp" size={17} strokeWidth={2.4} /> Send out
          </button>
        </div>

        {/* quick actions */}
        <div className="grid grid-cols-4 gap-2.5 px-5 pt-4">
          <QuickAction icon="swap" label="Swap" gradient onClick={() => router.push("/swap")} />
          <QuickAction icon="zap" label="Ttip" onClick={() => router.push("/ttip")} />
          <QuickAction icon="card" label="Card" onClick={() => router.push("/card")} />
          <QuickAction icon="bills" label="Bills" onClick={() => router.push("/bills")} />
        </div>

        {/* assets */}
        <div className="px-5 pt-6">
          <div className="flex justify-between items-baseline mb-2.5">
            <span className="font-grotesk font-semibold text-[14px]">Your assets</span>
            <button onClick={() => router.push("/swap")} className="font-sans text-[12px] text-brand-cyan">
              See all
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {shown.map((a) => (
              <button key={a.symbol} onClick={() => router.push("/swap?from=" + a.symbol)} className="flex items-center gap-3 bg-surface border border-white/[.06] rounded-2xl px-3.5 py-3 active:scale-[.99] transition">
                <AssetIcon color={a.color} glyph={a.glyph} />
                <div className="flex-1 text-left">
                  <div className="font-sans font-semibold text-[13.5px]">{a.name}</div>
                  <div className="font-sans text-[11px] text-white/40">
                    {formatCrypto(a.amount, a.symbol)} {a.symbol}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-grotesk font-semibold text-[13.5px]">{formatFiat(a.fiatValue, portfolio.fiat, { decimals: 0 })}</div>
                  <div className="font-sans font-medium text-[11px]" style={{ color: a.change24h >= 0 ? "#3DF5B0" : "#FF7A8A" }}>
                    {a.change24h >= 0 ? "▲" : "▼"} {Math.abs(a.change24h).toFixed(1)}%
                  </div>
                </div>
              </button>
            ))}
            {shown.every((a) => a.amount === 0) && (
              <div className="text-center text-white/40 text-[13px] py-4">
                No crypto yet.{" "}
                <button onClick={() => router.push("/deposit")} className="text-brand-cyan">
                  Add money
                </button>{" "}
                to get started.
              </div>
            )}
          </div>
        </div>
      </div>

      <TabBar />

      <Sheet open={fiatOpen} onClose={() => setFiatOpen(false)} title="Display currency">
        <div className="flex flex-col gap-2">
          {FIATS.map((f) => (
            <button key={f.code} onClick={() => setFiat(f.code)} className="flex items-center gap-3 bg-surface border border-white/[.06] rounded-2xl px-4 py-3.5 active:scale-[.99]">
              <span className="text-xl">{f.flag}</span>
              <span className="flex-1 text-left font-medium text-[14px]">{f.name}</span>
              {portfolio.fiat === f.code && <span className="text-brand-cyan">✓</span>}
            </button>
          ))}
        </div>
      </Sheet>
    </>
  );
}

function QuickAction({ icon, label, onClick, gradient }: { icon: IconName; label: string; onClick: () => void; gradient?: boolean }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-[7px] active:scale-95 transition">
      <div
        className="w-[56px] h-[56px] rounded-[20px] flex items-center justify-center"
        style={gradient ? { background: grad("135deg,#6D5BFF,#2AC8FF 60%,#3DF5B0"), color: "#04121A" } : { background: "#12141D", border: "1px solid rgba(255,255,255,.1)", color: "#fff" }}
      >
        <Icon name={icon} size={24} fill={gradient && icon === "zap" ? "#04121A" : undefined} />
      </div>
      <span className="font-sans font-medium text-[11.5px] text-white/75">{label}</span>
    </button>
  );
}
