"use client";

import { useEffect, useState } from "react";
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
  count: number;
  perReferral: number;
  referrals: { name: string; bonus: number; time: string }[];
}

export default function ReferralsPage() {
  const { state, toast } = useApp();
  const [data, setData] = useState<RefData | null>(null);
  const fiat = state.user.defaultFiat;

  useEffect(() => {
    apiGet<RefData>("/api/referrals").then(setData).catch(() => {});
  }, []);

  function copy(text: string) {
    navigator.clipboard?.writeText(text);
    toast("Invite link copied", "good");
  }
  function share() {
    if (data && navigator.share) navigator.share({ title: "Join me on Ttip", text: "Get ₦2,000 when you join Ttip", url: data.link }).catch(() => {});
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
          <div className="font-grotesk font-bold text-[22px] tracking-[-0.5px]">Give ₦2k, get ₦2k</div>
          <div className="font-sans text-[13px] text-white/55 mt-1.5 max-w-[260px] mx-auto">
            Share your link. When a friend joins and makes their first swap, you both earn {formatFiat(data?.perReferral ?? 2000, "NGN", { decimals: 0 })}.
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5 mt-3">
          <div className="bg-surface border border-white/[.06] rounded-[18px] p-4">
            <div className="text-[11px] text-white/45">Total earned</div>
            <div className="font-grotesk font-bold text-[22px] text-good mt-1">{formatFiat(data?.earned ?? 0, "NGN", { decimals: 0 })}</div>
          </div>
          <div className="bg-surface border border-white/[.06] rounded-[18px] p-4">
            <div className="text-[11px] text-white/45">Friends joined</div>
            <div className="font-grotesk font-bold text-[22px] mt-1">{data?.count ?? 0}</div>
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

        {data && data.referrals.length > 0 && (
          <div className="mt-4 mb-6">
            <div className="font-grotesk font-semibold text-[13.5px] mb-2">Recent joins</div>
            <div className="flex flex-col gap-2">
              {data.referrals.map((r, i) => (
                <div key={i} className="flex items-center gap-3 bg-surface border border-white/[.06] rounded-[14px] px-3.5 py-3">
                  <span className="w-8 h-8 rounded-full bg-surface2 flex items-center justify-center text-white/70 shrink-0"><Icon name="user" size={15} /></span>
                  <div className="flex-1 text-[13px]">{r.name} <span className="text-white/40">· {r.time}</span></div>
                  <div className="font-grotesk font-bold text-[13px] text-good">+{formatFiat(r.bonus, "NGN", { decimals: 0 })}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
