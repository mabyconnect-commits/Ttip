"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { BackHeader, GradientButton } from "@/components/ui";
import { Icon } from "@/components/Icon";

const ID_TYPES = [
  { id: "bvn", label: "BVN" },
  { id: "nin", label: "NIN" },
  { id: "passport", label: "Passport" },
  { id: "drivers_license", label: "Driver's licence" },
];

export default function KycPage() {
  const { state, action, toast } = useApp();
  const router = useRouter();
  const verified = state.user.kycStatus === "verified";
  const [fullName, setFullName] = useState(state.user.name);
  const [idType, setIdType] = useState("bvn");
  const [idNumber, setIdNumber] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (fullName.trim().length < 2) return toast("Enter your full legal name", "bad");
    if (idNumber.trim().length < 6) return toast("Enter a valid ID number", "bad");
    setLoading(true);
    try {
      await action("/api/kyc", { fullName, idType, idNumber });
      toast("Identity verified", "good");
      router.push("/account");
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setLoading(false);
    }
  }

  if (verified) {
    return (
      <div className="flex flex-col flex-1 px-[22px] min-h-0">
        <BackHeader title="KYC" />
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center pb-16">
          <div className="w-20 h-20 rounded-full flex items-center justify-center text-good" style={{ background: "rgba(61,245,176,.10)", border: "1px solid rgba(61,245,176,.3)" }}>
            <Icon name="check" size={36} strokeWidth={2.6} />
          </div>
          <div className="font-grotesk font-bold text-[22px]">You&apos;re verified</div>
          <p className="text-white/50 text-[14px] max-w-[280px]">
            Tier {state.user.kycTier} unlocked. Higher swap and payout limits are active on your account.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 px-[22px] min-h-0">
      <BackHeader title="Verify your account" />
      <div className="flex-1 overflow-y-auto no-scrollbar pb-6">
        <p className="text-white/50 text-[13.5px] mt-1 mb-4">
          Verify your identity to raise your limits and unlock bank payouts. Takes about a minute.
        </p>
        <div className="flex flex-col gap-2.5">
          <Field label="Full legal name" value={fullName} onChange={setFullName} placeholder="As on your ID" />
          <div>
            <span className="text-[12px] text-white/50 font-medium ml-1">ID type</span>
            <div className="grid grid-cols-2 gap-2 mt-1.5">
              {ID_TYPES.map((t) => (
                <button key={t.id} onClick={() => setIdType(t.id)} className={`h-[46px] rounded-2xl border text-[13px] font-medium ${idType === t.id ? "border-brand-cyan bg-brand-cyan/10 text-brand-cyan" : "border-white/10 bg-surface text-white/70"}`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <Field label="ID number" value={idNumber} onChange={(v) => setIdNumber(v.replace(/[^0-9A-Za-z]/g, ""))} placeholder="Enter your ID number" />
        </div>
        <div className="mt-4 rounded-2xl px-4 py-3 text-[12px] text-white/55" style={{ background: "rgba(42,200,255,.06)", border: "1px solid rgba(42,200,255,.2)" }}>
          🔒 Your details are used only to verify your identity.
        </div>
      </div>
      <div className="pb-6 pt-2">
        <GradientButton onClick={submit} loading={loading}>Verify identity</GradientButton>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-[12px] text-white/50 font-medium ml-1">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="mt-1.5 w-full h-[52px] rounded-2xl bg-surface border border-white/10 px-4 text-[15px] outline-none focus:border-brand-cyan/60" />
    </label>
  );
}
