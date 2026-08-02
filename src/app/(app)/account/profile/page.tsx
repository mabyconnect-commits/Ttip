"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { BackHeader, GradientButton, Avatar } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { BankPicker } from "@/components/BankPicker";
import type { Bank } from "@/lib/banks";
import { FIATS } from "@/lib/constants";

export default function EditProfilePage() {
  const { state, action, toast } = useApp();
  const router = useRouter();
  const { user } = state;

  const [name, setName] = useState(user.name);
  const [fiat, setFiat] = useState(user.defaultFiat);
  const [bank, setBank] = useState<Bank | null>(null);
  const [account, setAccount] = useState("");
  const [bankOpen, setBankOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const dirty =
    name.trim() !== user.name || fiat !== user.defaultFiat || (!!bank && account.length >= 6);

  async function save() {
    if (name.trim().length < 1) return toast("Enter your name", "bad");
    setLoading(true);
    try {
      await action("/api/profile", {
        name: name.trim(),
        defaultFiat: fiat,
        ...(bank && account.length >= 6 ? { bankName: bank.name, bankAccount: account } : {}),
      }, "PATCH");
      toast("Profile updated", "good");
      router.push("/account");
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col flex-1 px-[22px] min-h-0">
      <BackHeader title="My profile" />
      <div className="flex-1 overflow-y-auto no-scrollbar pb-6">
        <div className="flex flex-col items-center gap-2 py-3">
          <Avatar gradient={user.avatarGradient} initial={user.initial} size={76} />
          <div className="text-white/45 text-[12.5px]">@{user.username}</div>
        </div>

        <div className="flex flex-col gap-3 mt-2">
          <Field label="Full name" value={name} onChange={setName} />
          <ReadOnly label="Username" value={"@" + user.username} hint="Usernames can't be changed — it's your tip link." />
          <ReadOnly label="Email" value={user.email} />

          <div>
            <span className="text-[12px] text-white/50 font-medium ml-1">Cash out currency</span>
            <div className="mt-1.5 grid grid-cols-5 gap-2">
              {FIATS.map((f) => (
                <button
                  key={f.code}
                  onClick={() => setFiat(f.code)}
                  className={`h-[52px] rounded-2xl border flex flex-col items-center justify-center gap-0.5 ${fiat === f.code ? "border-brand-cyan bg-brand-cyan/10" : "border-white/10 bg-surface"}`}
                >
                  <span className="text-base leading-none">{f.flag}</span>
                  <span className="text-[10px] text-white/60">{f.code}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="text-[12px] text-white/50 font-medium ml-1">Payout bank</span>
            <div className="text-white/40 text-[11.5px] ml-1 mb-1.5">Current: {user.bankAccount ?? "not set"}</div>
            <button onClick={() => setBankOpen(true)} className="w-full bg-surface border border-white/[.08] rounded-2xl px-4 h-[52px] flex items-center justify-between text-[14px]">
              <span className={bank ? "text-white font-medium" : "text-white/35"}>{bank ? bank.name : "Change bank"}</span>
              <Icon name="chevronDown" size={15} className="text-white/40" />
            </button>
            {bank && (
              <input value={account} onChange={(e) => setAccount(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" maxLength={10} placeholder="Account number" className="w-full bg-surface border border-white/[.08] rounded-2xl px-4 h-[52px] outline-none text-[14px] focus:border-brand-cyan/50 mt-2" />
            )}
          </div>
        </div>
      </div>
      <div className="pb-6 pt-2">
        <GradientButton onClick={save} loading={loading} disabled={!dirty}>Save changes</GradientButton>
      </div>

      <BankPicker open={bankOpen} onClose={() => setBankOpen(false)} onPick={(b) => setBank(b)} />
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-[12px] text-white/50 font-medium ml-1">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="mt-1.5 w-full h-[52px] rounded-2xl bg-surface border border-white/10 px-4 text-[15px] outline-none focus:border-brand-cyan/60" />
    </label>
  );
}

function ReadOnly({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <span className="text-[12px] text-white/50 font-medium ml-1">{label}</span>
      <div className="mt-1.5 w-full h-[52px] rounded-2xl bg-surface/50 border border-white/[.06] px-4 flex items-center text-[15px] text-white/60">{value}</div>
      {hint && <span className="text-[11px] text-white/35 ml-1 mt-1 block">{hint}</span>}
    </div>
  );
}
