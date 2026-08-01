"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useApp } from "@/context/AppContext";
import { usePrices } from "@/lib/usePrices";
import { apiGet } from "@/lib/client";
import { TabBar } from "@/components/TabBar";
import { Sheet, GradientButton } from "@/components/ui";
import { Icon, type IconName } from "@/components/Icon";
import { formatUsd, formatCrypto } from "@/lib/format";

const GOLD_TARGET = 4000;

interface Quest { id: string; title: string; reward: number; icon: string; progress: number; goal: number }

export default function CardPage() {
  const { state, action, toast } = useApp();
  const { convert } = usePrices();
  const router = useRouter();
  const card = state.card;
  const [fundOpen, setFundOpen] = useState(false);
  const [questsOpen, setQuestsOpen] = useState(false);
  const [quests, setQuests] = useState<Quest[]>([]);
  const [claiming, setClaiming] = useState(false);

  async function claimDrop() {
    if (claiming) return;
    setClaiming(true);
    try {
      const res: any = await action("/api/rewards", { action: "daily" });
      toast(`Claimed +${res.awarded} pts`, "good");
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setClaiming(false);
    }
  }

  function openQuests() {
    setQuestsOpen(true);
    apiGet<{ quests: Quest[] }>("/api/rewards").then((d) => setQuests(d.quests)).catch(() => {});
  }
  const [usd, setUsd] = useState("50");
  const [src, setSrc] = useState("USDT");
  const [loading, setLoading] = useState(false);

  const points = state.user.points;
  const pct = Math.min(100, Math.round((points / GOLD_TARGET) * 100));
  const toGold = Math.max(0, GOLD_TARGET - points);

  async function fund() {
    const amt = parseFloat(usd) || 0;
    if (amt <= 0) return toast("Enter an amount", "bad");
    setLoading(true);
    try {
      await action("/api/card", { action: "fund", symbol: src, amountUsd: amt });
      toast(`Funded ${formatUsd(amt)} to your card`, "good");
      setFundOpen(false);
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setLoading(false);
    }
  }

  async function toggleFreeze() {
    try {
      await action("/api/card", { action: card?.frozen ? "unfreeze" : "freeze" });
      toast(card?.frozen ? "Card unfrozen" : "Card frozen", "good");
    } catch (e: any) {
      toast(e.message, "bad");
    }
  }

  const srcBal = state.portfolio.assets.find((a) => a.symbol === src)?.amount ?? 0;
  const cost = convert(parseFloat(usd) || 0, "USD", src);

  return (
    <>
      <div className="flex items-center justify-between px-[22px] pt-3.5 pb-4">
        <div className="font-grotesk font-bold text-[22px]">Card</div>
        <span className="font-grotesk font-semibold text-[11px] text-white/60 border border-white/12 rounded-full px-2.5 py-1">
          {card?.frozen ? "Frozen" : "Active · USD"}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar px-[22px] pb-4">
        {/* virtual card */}
        <div className="rounded-[22px] p-[22px] border border-white/10 relative overflow-hidden" style={{ aspectRatio: "1.62", background: "linear-gradient(135deg,#101528 0%,#0A2233 55%,#0B2C24 100%)", opacity: card?.frozen ? 0.6 : 1 }}>
          <div className="absolute rounded-full" style={{ top: "-30%", right: "-20%", width: 220, height: 220, background: "radial-gradient(circle,rgba(109,91,255,.35),transparent 70%)" }} />
          <div className="flex justify-between items-start relative">
            <Image src="/ttip-logo.png" alt="Ttip" width={38} height={38} className="rounded-[10px]" />
            <span className="font-grotesk font-semibold text-[13px] text-white/70 italic">virtual · dollar</span>
          </div>
          <div className="font-grotesk font-semibold text-[20px] tracking-[3px] mt-8">5399 •••• •••• {card?.last4}</div>
          <div className="flex justify-between items-end mt-5 relative">
            <div>
              <div className="font-sans text-[10px] text-white/40">CARD HOLDER</div>
              <div className="font-grotesk font-semibold text-[14px]">{card?.holder}</div>
            </div>
            <div className="text-right">
              <div className="font-sans text-[10px] text-white/40">BALANCE</div>
              <div className="font-grotesk font-bold text-[18px] text-good">{formatUsd(card?.balanceUsd ?? 0)}</div>
            </div>
          </div>
        </div>

        <div className="flex gap-2.5 py-3.5">
          <button onClick={() => setFundOpen(true)} className="flex-1 h-[48px] rounded-2xl flex items-center justify-center gap-1.5 font-grotesk font-semibold text-[14px] bg-good text-ink">
            <Icon name="plus" size={16} strokeWidth={2.6} /> Fund from crypto
          </button>
          <button onClick={toggleFreeze} className="flex-1 h-[48px] rounded-2xl border border-white/12 flex items-center justify-center gap-1.5 font-grotesk font-semibold text-[14px]">
            <Icon name={card?.frozen ? "sun" : "snowflake"} size={16} /> {card?.frozen ? "Unfreeze" : "Freeze"}
          </button>
        </div>

        {/* rewards */}
        <div className="bg-surface border border-white/[.06] rounded-[20px] p-4">
          <div className="flex justify-between items-center">
            <span className="font-grotesk font-semibold text-[14px]">Rewards</span>
            <span className="font-grotesk font-semibold text-[12px] text-white/60">{points.toLocaleString()} pts</span>
          </div>
          <div className="h-2 rounded-full bg-white/[.08] mt-3 overflow-hidden">
            <div className="h-full rounded-full bg-good" style={{ width: `${pct}%` }} />
          </div>
          <div className="font-sans text-[12px] text-white/50 mt-2.5">
            {toGold > 0 ? <>{toGold.toLocaleString()} pts to <b className="text-good">Gold</b> — zero-fee swaps all month</> : <><b className="text-good">Gold unlocked</b> — zero-fee swaps all month</>}
          </div>
          <div className="flex gap-2 mt-3.5">
            <RewardTile icon="gift" label="Daily drop" onClick={claimDrop} />
            <RewardTile icon="grid" label="Quests" onClick={openQuests} />
            <RewardTile icon="user" label="Invite = ₦2k" onClick={() => router.push("/referrals")} />
          </div>
        </div>

        {/* bills shortcut */}
        <button onClick={() => router.push("/bills")} className="w-full flex items-center gap-3 bg-surface border border-white/[.06] rounded-[18px] p-3.5 mt-2.5 active:scale-[.99]">
          <span className="w-9 h-9 rounded-full bg-surface2 flex items-center justify-center text-white/70 shrink-0"><Icon name="bills" size={17} /></span>
          <div className="flex-1 text-left">
            <div className="font-sans font-semibold text-[13.5px]">Bills &amp; airtime</div>
            <div className="font-sans text-[11.5px] text-white/45">Airtime, data, electricity, TV — pay straight from crypto</div>
          </div>
          <span className="text-white/40"><Icon name="chevronRight" size={18} /></span>
        </button>
      </div>

      <TabBar />

      <Sheet open={fundOpen} onClose={() => setFundOpen(false)} title="Fund card from crypto">
        <div className="bg-surface border border-white/[.08] rounded-2xl px-4 py-4 flex items-center justify-between mb-3">
          <div className="flex items-center gap-1">
            <span className="text-[26px] font-grotesk font-bold">$</span>
            <input value={usd} onChange={(e) => setUsd(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className="bg-transparent outline-none text-[26px] font-grotesk font-bold w-24" />
          </div>
          <div className="text-right text-[12px] text-white/50">
            ≈ {formatCrypto(cost, src)} {src}
            <div className="text-[11px] text-white/35">bal {formatCrypto(srcBal, src)}</div>
          </div>
        </div>
        <div className="flex gap-2 mb-4">
          {["USDT", "USDC", "BTC", "ETH"].map((s) => (
            <button key={s} onClick={() => setSrc(s)} className={`flex-1 h-11 rounded-xl border font-grotesk font-bold text-[13px] ${src === s ? "bg-white text-[#07080D] border-white" : "border-white/14 text-white/70"}`}>
              {s}
            </button>
          ))}
        </div>
        <GradientButton onClick={fund} loading={loading}>
          Add {formatUsd(parseFloat(usd) || 0)} to card
        </GradientButton>
      </Sheet>

      <Sheet open={questsOpen} onClose={() => setQuestsOpen(false)} title="Quests · earn points">
        <div className="flex flex-col gap-2">
          {quests.map((q) => {
            const done = q.progress >= q.goal;
            return (
              <div key={q.id} className="bg-surface border border-white/[.06] rounded-2xl p-3.5">
                <div className="flex items-center gap-3">
                  <span className="text-xl">{q.icon}</span>
                  <div className="flex-1">
                    <div className="font-medium text-[14px]">{q.title}</div>
                    <div className="text-white/40 text-[11.5px]">+{q.reward} pts</div>
                  </div>
                  {done ? (
                    <span className="text-good"><Icon name="check" size={18} strokeWidth={3} /></span>
                  ) : (
                    <span className="text-white/50 font-grotesk text-[12px]">{q.progress}/{q.goal}</span>
                  )}
                </div>
                <div className="h-1.5 rounded-full bg-white/[.08] mt-2.5 overflow-hidden">
                  <div className="h-full rounded-full bg-good" style={{ width: `${Math.round((q.progress / q.goal) * 100)}%` }} />
                </div>
              </div>
            );
          })}
          {quests.length === 0 && <div className="text-center text-white/40 text-[13px] py-4">Loading quests…</div>}
        </div>
      </Sheet>
    </>
  );
}

function RewardTile({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex-1 bg-surface2 rounded-2xl p-3 flex flex-col items-center gap-1.5 active:scale-95 transition">
      <Icon name={icon} size={18} className="text-white/80" />
      <div className="font-sans font-medium text-[10.5px] text-white/60">{label}</div>
    </button>
  );
}
