"use client";

import { useApp } from "@/context/AppContext";
import { useRouter } from "next/navigation";
import { BackHeader } from "@/components/ui";
import { Icon } from "@/components/Icon";

const TIERS = [
  { tier: 1, name: "Starter", daily: "₦500,000", single: "₦100,000", req: "Email verified" },
  { tier: 2, name: "Verified", daily: "₦5,000,000", single: "₦2,000,000", req: "ID (BVN/NIN) verified" },
  { tier: 3, name: "Pro", daily: "₦50,000,000", single: "₦10,000,000", req: "Address + ID verified" },
];

export default function LimitsPage() {
  const { state } = useApp();
  const router = useRouter();
  const current = state.user.kycTier;

  return (
    <div className="flex flex-col flex-1 px-[22px] min-h-0">
      <BackHeader title="Spending limits" />
      <div className="flex-1 overflow-y-auto no-scrollbar pb-6">
        <p className="text-white/50 text-[13.5px] mt-1 mb-4">
          You&apos;re on <b className="text-white">Tier {current}</b>. Verify your identity to raise your limits.
        </p>
        <div className="flex flex-col gap-3">
          {TIERS.map((t) => {
            const active = t.tier === current;
            const done = t.tier < current;
            return (
              <div
                key={t.tier}
                className="rounded-[18px] p-4 border"
                style={active ? { borderColor: "rgba(42,200,255,.5)", background: "rgba(42,200,255,.06)" } : { borderColor: "rgba(255,255,255,.07)", background: "#0D0F17" }}
              >
                <div className="flex items-center justify-between">
                  <div className="font-grotesk font-semibold text-[15px] flex items-center gap-2">
                    Tier {t.tier} · {t.name}
                    {active && <span className="text-[10px] text-brand-cyan border border-brand-cyan/40 rounded-full px-2 py-0.5">Current</span>}
                    {done && <span className="text-good"><Icon name="check" size={15} strokeWidth={3} /></span>}
                  </div>
                </div>
                <div className="flex gap-6 mt-3 text-[12.5px]">
                  <div><div className="text-white/40">Daily</div><div className="font-grotesk font-semibold mt-0.5">{t.daily}</div></div>
                  <div><div className="text-white/40">Per transfer</div><div className="font-grotesk font-semibold mt-0.5">{t.single}</div></div>
                </div>
                <div className="text-white/40 text-[11.5px] mt-2.5">Requires: {t.req}</div>
              </div>
            );
          })}
        </div>
        {current < 2 && (
          <button onClick={() => router.push("/account/kyc")} className="w-full mt-4 bg-good text-ink h-[52px] rounded-2xl flex items-center justify-center font-grotesk font-semibold text-[15px]">
            Verify to unlock Tier 2
          </button>
        )}
      </div>
    </div>
  );
}
