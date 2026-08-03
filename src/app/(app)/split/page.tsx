"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { apiGet } from "@/lib/client";
import { BackHeader, GradientButton, Avatar } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { formatFiat } from "@/lib/format";
import { Receipt } from "@/components/Receipt";

interface Contact {
  name: string;
  handle: string;
  gradient: string;
  initial: string;
  onPlatform: boolean;
}

export default function SplitPage() {
  const { state, action, toast } = useApp();
  const router = useRouter();
  const fiat = state.user.defaultFiat;
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [total, setTotal] = useState(fiat === "NGN" ? 84000 : 800);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [receipt, setReceipt] = useState<any>(null);

  useEffect(() => {
    apiGet<{ contacts: Contact[] }>("/api/contacts").then((d) => setContacts(d.contacts.filter((c) => c.onPlatform))).catch(() => {});
  }, []);

  const heads = picked.length + 1;
  const share = total / heads;

  function toggle(h: string) {
    setPicked((p) => (p.includes(h) ? p.filter((x) => x !== h) : [...p, h]));
  }

  async function settle() {
    if (picked.length === 0) return toast("Add at least one person", "bad");
    if (total <= 0) return toast("Enter the total", "bad");
    setLoading(true);
    try {
      const res: any = await action("/api/split", { total, fiat, participants: picked, note: note || undefined });
      setReceipt(res.receipt);
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col flex-1 px-[22px] min-h-0">
      <BackHeader title="Split a bill" />
      <div className="flex-1 overflow-y-auto no-scrollbar pt-2">
        <div className="bg-surface border border-white/[.08] rounded-[22px] p-5 text-center">
          <div className="text-[12px] text-white/45">Total bill</div>
          <div className="flex items-center justify-center gap-1 mt-1">
            <input
              value={total || ""}
              onChange={(e) => setTotal(parseFloat(e.target.value.replace(/[^0-9.]/g, "")) || 0)}
              inputMode="decimal"
              className="bg-transparent outline-none text-center font-grotesk font-bold text-[40px] tracking-[-1px] w-full"
            />
          </div>
          <div className="text-[13px] text-good mt-1">
            {picked.length === 0
              ? "Select who's splitting below"
              : `${formatFiat(share, fiat, { decimals: 0 })} each · ${heads} people`}
          </div>
        </div>

        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What's it for? e.g. dinner, rent" className="w-full bg-surface border border-white/[.08] rounded-2xl px-4 h-[52px] outline-none text-[14px] focus:border-brand-cyan/50 mt-3" />

        <div className="font-grotesk font-semibold text-[13.5px] mt-4 mb-2">Split with</div>
        <div className="flex flex-col gap-2">
          {contacts.map((c) => {
            const on = picked.includes(c.handle);
            return (
              <button key={c.handle} onClick={() => toggle(c.handle)} className={`flex items-center gap-3 rounded-2xl px-3.5 py-3 border transition ${on ? "bg-brand-cyan/10 border-brand-cyan/50" : "bg-surface border-white/[.06]"}`}>
                <Avatar gradient={c.gradient} initial={c.initial} size={36} />
                <div className="flex-1 text-left">
                  <div className="font-semibold text-[14px]">{c.name}</div>
                  <div className="text-[12px] text-white/40">{c.handle}</div>
                </div>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center ${on ? "bg-brand-cyan text-[#04121A]" : "border border-white/20"}`}>{on && <Icon name="check" size={13} strokeWidth={3} />}</div>
              </button>
            );
          })}
          {contacts.length === 0 && <div className="text-center text-white/40 text-[13px] py-4">No friends on Ttip yet.</div>}
        </div>
        <div className="h-4" />
      </div>

      <div className="pb-6 pt-2">
        <GradientButton onClick={settle} loading={loading} disabled={picked.length === 0}>
          Request {formatFiat(share, fiat, { decimals: 0 })} × {picked.length}
        </GradientButton>
      </div>

      {receipt && (
        <Receipt
          onDone={() => { setReceipt(null); router.push("/feed"); }}
          badge="Split"
          title="Split settled"
          amount={formatFiat(receipt.total, receipt.fiat, { decimals: 0 })}
          fields={[
            { label: "Type", value: "Bill split" },
            { label: "Settled by", value: state.user.name },
            { label: "Total", value: formatFiat(receipt.total, receipt.fiat, { decimals: 0 }) },
            { label: "Split between", value: `${receipt.settled} friends` },
            { label: "Each pays", value: formatFiat(receipt.share, receipt.fiat, { decimals: 0 }) },
          ]}
        />
      )}
    </div>
  );
}
