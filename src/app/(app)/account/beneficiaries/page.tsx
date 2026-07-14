"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/client";
import { useApp } from "@/context/AppContext";
import { BackHeader, Avatar, Sheet, GradientButton } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { BankPicker } from "@/components/BankPicker";
import type { Bank } from "@/lib/banks";

interface Ben {
  id: string; name: string; bank: string; account: string; gradient: string; initial: string;
}

export default function BeneficiariesPage() {
  const { toast } = useApp();
  const [list, setList] = useState<Ben[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [bankOpen, setBankOpen] = useState(false);
  const [bank, setBank] = useState<Bank | null>(null);
  const [name, setName] = useState("");
  const [account, setAccount] = useState("");
  const [saving, setSaving] = useState(false);

  function load() {
    apiGet<{ beneficiaries: Ben[] }>("/api/beneficiaries").then((d) => setList(d.beneficiaries)).catch(() => {});
  }
  useEffect(load, []);

  async function save() {
    if (!bank) return toast("Choose a bank", "bad");
    if (!account) return toast("Enter account number", "bad");
    if (!name) return toast("Enter account name", "bad");
    setSaving(true);
    try {
      await apiPost("/api/beneficiaries", { name, bank: bank.name, account });
      toast("Beneficiary saved", "good");
      setAddOpen(false); setBank(null); setName(""); setAccount("");
      load();
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    await fetch(`/api/beneficiaries?id=${id}`, { method: "DELETE" }).catch(() => {});
    setList((l) => l.filter((b) => b.id !== id));
    toast("Removed", "info");
  }

  return (
    <div className="flex flex-col flex-1 px-[22px] min-h-0">
      <BackHeader title="Beneficiaries" right={<button onClick={() => setAddOpen(true)} className="text-brand-cyan text-[13px] font-semibold">Add</button>} />
      <div className="flex-1 overflow-y-auto no-scrollbar pb-6">
        {list.length === 0 && (
          <div className="text-center text-white/40 text-[13px] py-10">
            No saved accounts yet.<br />
            <button onClick={() => setAddOpen(true)} className="text-brand-cyan mt-1">Add a beneficiary</button>
          </div>
        )}
        <div className="flex flex-col gap-2 mt-1">
          {list.map((b) => (
            <div key={b.id} className="flex items-center gap-3 bg-surface border border-white/[.06] rounded-[16px] px-3.5 py-3">
              <Avatar gradient={b.gradient} initial={b.initial} size={40} />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-[14px] truncate">{b.name}</div>
                <div className="text-white/40 text-[12px] truncate">{b.bank} · {b.account}</div>
              </div>
              <button onClick={() => remove(b.id)} className="text-white/30 hover:text-bad p-1"><Icon name="trash" size={17} /></button>
            </div>
          ))}
        </div>
      </div>

      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title="Add beneficiary">
        <div className="flex flex-col gap-2.5">
          <button onClick={() => setBankOpen(true)} className="bg-surface border border-white/[.08] rounded-2xl px-4 h-[52px] flex items-center justify-between text-[14px]">
            <span className={bank ? "text-white font-medium" : "text-white/35"}>{bank ? bank.name : "Choose bank"}</span>
            <span className="text-white/40">▾</span>
          </button>
          <input value={account} onChange={(e) => setAccount(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" maxLength={10} placeholder="Account number" className="bg-surface border border-white/[.08] rounded-2xl px-4 h-[52px] outline-none text-[14px] focus:border-brand-cyan/50" />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Account name" className="bg-surface border border-white/[.08] rounded-2xl px-4 h-[52px] outline-none text-[14px] focus:border-brand-cyan/50" />
          <GradientButton onClick={save} loading={saving} className="mt-1">Save beneficiary</GradientButton>
        </div>
      </Sheet>

      <BankPicker open={bankOpen} onClose={() => setBankOpen(false)} onPick={(b) => setBank(b)} />
    </div>
  );
}
