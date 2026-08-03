"use client";

import { useApp } from "@/context/AppContext";
import { useRouter } from "next/navigation";
import { BackHeader } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { KYC_TIERS } from "@/lib/constants";

// Straight from the shared ladder the server enforces, so the numbers shown
// here can never drift from the ones actually applied. Tier 0 is the
// pre-verification state and isn't shown as a rung to aim for.
const TIERS = KYC_TIERS.filter((t) => t.tier > 0);
const naira = (n: number) => "₦" + n.toLocaleString("en-US");

export default function LimitsPage() {
  const { state } = useApp();
  const router = useRouter();
  const current = state.user.kycTier;

  return (
    <div className="flex flex-col flex-1 px-[22px] min-h-0">
      <BackHeader title="Spending limits" />
      <div className="flex-1 overflow-y-auto no-scrollbar pb-6">
        <p className="text-white/50 text-[13.5px] mt-1 mb-4">
          You&apos;re on <b className="text-white">Tier {current}</b>.{" "}
          {current < 1
            ? "Verify your BVN to activate withdrawals and unlock your limits."
            : current < 3
              ? "Add another document to raise your limits."
              : "You're on the highest tier."}
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
                  <div><div className="text-white/40">Daily</div><div className="font-grotesk font-semibold mt-0.5">{naira(t.dailyNgn)}</div></div>
                  <div><div className="text-white/40">Per transfer</div><div className="font-grotesk font-semibold mt-0.5">{naira(t.perTransferNgn)}</div></div>
                </div>
                <div className="text-white/40 text-[11.5px] mt-2.5">Requires: {t.requires}</div>
              </div>
            );
          })}
        </div>
        {current < 3 && (
          <button onClick={() => router.push("/account/kyc")} className="w-full mt-4 bg-good text-ink h-[52px] rounded-2xl flex items-center justify-center font-grotesk font-semibold text-[15px]">
            {current < 1 ? "Verify your BVN" : "Add a document to upgrade"}
          </button>
        )}
      </div>
    </div>
  );
}
