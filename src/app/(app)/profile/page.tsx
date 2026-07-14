"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { apiGet } from "@/lib/client";
import { BackHeader, Avatar, Sheet } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { QR } from "@/components/QR";

interface ProfileData {
  link: string;
  fullLink: string;
  friends: number;
  recentTippers: { handle: string; note: string | null; amount: number; symbol: string; time: string }[];
}

export default function ProfilePage() {
  const { state, logout, toast } = useApp();
  const router = useRouter();
  const { user } = state;
  const [data, setData] = useState<ProfileData | null>(null);
  const [settings, setSettings] = useState(false);

  useEffect(() => {
    apiGet<ProfileData>("/api/profile").then(setData).catch(() => {});
  }, []);

  function copy(text: string) {
    navigator.clipboard?.writeText(text);
    toast("Tip link copied", "good");
  }
  function share() {
    if (data && navigator.share) navigator.share({ title: `Tip @${user.username} on Ttip`, url: data.fullLink }).catch(() => {});
    else if (data) copy(data.fullLink);
  }

  return (
    <div className="flex flex-col flex-1 px-[22px] min-h-0" style={{ background: "radial-gradient(100% 45% at 50% 0%,#141A2E 0%,#07080D 60%)" }}>
      <BackHeader title="Profile" right={<button onClick={() => router.push("/account")} className="w-9 h-9 rounded-[18px] border border-white/12 flex items-center justify-center text-white/80"><Icon name="settings" size={17} /></button>} />

      <div className="flex-1 overflow-y-auto no-scrollbar">
        <div className="flex flex-col items-center gap-2 py-2">
          <Avatar gradient={user.avatarGradient} initial={user.initial} size={84} />
          <div className="font-grotesk font-bold text-[20px]">
            {user.name} {user.verified && <span className="text-brand-cyan text-[15px]">✓</span>}
          </div>
          <div className="font-sans font-medium text-[13px] text-good">{data?.link ?? `ttip.money/u/${user.username}`}</div>
          <div className="flex gap-[18px] font-sans text-[12px] text-white/50 mt-0.5">
            <span><b className="text-white">{data?.friends ?? 0}</b> friends</span>
            <span><b className="text-white">🔥 {user.streakDays}</b> streak</span>
            <span><b className="text-white">{user.points.toLocaleString()}</b> pts</span>
          </div>
        </div>

        {/* QR card */}
        <div className="bg-surface border border-white/[.08] rounded-[22px] p-[18px] flex items-center gap-4 mt-2">
          {data && <QR value={data.fullLink} size={104} />}
          <div className="flex-1 flex flex-col gap-2">
            <div className="font-grotesk font-semibold text-[14px]">Get Ttipped anywhere</div>
            <div className="font-sans text-[12px] text-white/50">Print it, post it, drop it in your bio. Anyone can tip you — no app needed.</div>
            <div className="flex gap-2 mt-0.5">
              <button onClick={share} className="font-grotesk font-semibold text-[11.5px] grad-bg rounded-xl px-3 py-1.5 text-[#04121A]">Share link</button>
              <button onClick={() => data && copy(data.fullLink)} className="font-grotesk font-semibold text-[11.5px] border border-white/14 rounded-xl px-3 py-1.5">Copy</button>
            </div>
          </div>
        </div>

        {/* socials */}
        <div className="flex gap-2 mt-3">
          {[["📸", "IG bio"], ["🐦", "X card"], ["🎵", "TikTok"], ["💬", "WhatsApp"]].map(([icon, label]) => (
            <button key={label} onClick={() => { data && copy(data.fullLink); }} className="flex-1 bg-surface border border-white/[.06] rounded-[16px] py-3 text-center active:scale-95">
              <div className="text-[17px]">{icon}</div>
              <div className="font-sans font-medium text-[10.5px] text-white/55 mt-1">{label}</div>
            </button>
          ))}
        </div>

        {/* recent tippers */}
        <div className="mt-4 mb-6">
          <div className="font-grotesk font-semibold text-[13.5px] mb-2">Recent tippers</div>
          <div className="flex flex-col gap-2">
            {data?.recentTippers.length ? (
              data.recentTippers.map((t, i) => (
                <div key={i} className="flex items-center gap-3 bg-surface border border-white/[.06] rounded-[14px] px-3.5 py-3">
                  <div className="w-[30px] h-[30px] rounded-full grad-bg-135 flex items-center justify-center font-grotesk font-bold text-[12px] text-[#04121A]">{t.handle.replace(/^@/, "").charAt(0).toUpperCase()}</div>
                  <div className="flex-1 text-[12.5px]">
                    {t.handle} {t.note && <span className="text-white/40">· “{t.note}”</span>}
                  </div>
                  <div className="font-grotesk font-bold text-[13px] text-good">+{t.symbol}{t.amount.toLocaleString()}</div>
                </div>
              ))
            ) : (
              <div className="text-center text-white/40 text-[13px] py-4">No tips received yet — share your link to get started.</div>
            )}
          </div>
        </div>
      </div>

      <Sheet open={settings} onClose={() => setSettings(false)} title="Settings">
        <div className="flex flex-col gap-2">
          <Row label="Signed in as" value={user.email} />
          <Row label="Username" value={"@" + user.username} />
          <Row label="Payout bank" value={user.bankAccount ?? "Not set"} />
          <Row label="Referral code" value={user.referralCode} />
          <button onClick={() => router.push("/dashboard")} className="text-left bg-surface border border-white/[.06] rounded-2xl px-4 py-3.5 text-[14px] mt-1">🖥️ Open web dashboard</button>
          <button onClick={logout} className="text-left bg-bad/10 border border-bad/30 text-bad rounded-2xl px-4 py-3.5 text-[14px] font-medium mt-1">Sign out</button>
        </div>
      </Sheet>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between bg-surface border border-white/[.06] rounded-2xl px-4 py-3">
      <span className="text-[13px] text-white/50">{label}</span>
      <span className="text-[13px] font-medium">{value}</span>
    </div>
  );
}
