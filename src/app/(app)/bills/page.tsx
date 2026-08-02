"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { usePrices } from "@/lib/usePrices";
import { BackHeader, GradientButton } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { BILL_CATEGORIES } from "@/lib/constants";
import { pickFunding } from "@/lib/funding";
import { formatFiat, formatCrypto } from "@/lib/format";
import { Receipt } from "@/components/Receipt";

export default function BillsPage() {
  const { state, action, toast } = useApp();
  const { convert } = usePrices();
  const router = useRouter();
  const fiat = state.user.defaultFiat;

  const [cat, setCat] = useState<(typeof BILL_CATEGORIES)[number] | null>(null);
  const [provider, setProvider] = useState("");
  const [account, setAccount] = useState("");
  const [amount, setAmount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [receipt, setReceipt] = useState<any>(null);

  const funding = pickFunding(state.portfolio.assets);
  const cost = convert(amount, fiat, funding);
  const fundBal = state.portfolio.assets.find((a) => a.symbol === funding)?.amount ?? 0;

  function openCat(c: (typeof BILL_CATEGORIES)[number]) {
    setCat(c);
    setProvider(c.providers[0]);
    setAmount(c.amounts[1]);
    setAccount("");
  }

  async function pay() {
    if (!cat) return;
    if (!account) return toast("Enter the account / phone number", "bad");
    if (amount <= 0) return toast("Choose an amount", "bad");
    if (cost > fundBal) return toast(`Not enough ${funding} to pay this bill`, "bad");
    setLoading(true);
    try {
      const res: any = await action("/api/bills", {
        category: cat.id,
        provider,
        account,
        fiat,
        fiatAmount: amount,
        fundingSymbol: funding,
      });
      setReceipt(res.receipt);
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col flex-1 px-[22px] min-h-0">
      <BackHeader title={cat ? cat.title : "Bills & airtime"} right={cat ? <button onClick={() => setCat(null)} className="text-brand-cyan text-[13px]">All</button> : undefined} />

      {!cat ? (
        <div className="flex-1 overflow-y-auto no-scrollbar pt-2">
          <div className="grid grid-cols-3 gap-2.5">
            {BILL_CATEGORIES.map((c) => (
              <button key={c.id} onClick={() => openCat(c)} className="bg-surface border border-white/[.06] rounded-[18px] py-5 flex flex-col items-center gap-2 active:scale-95 transition">
                <span className="text-[26px]">{c.icon}</span>
                <span className="font-sans font-medium text-[12px] text-white/75">{c.title}</span>
              </button>
            ))}
          </div>
          <div className="mt-4 rounded-2xl px-4 py-3.5 text-[12.5px] text-white/60 flex gap-2.5" style={{ background: "rgba(42,200,255,.06)", border: "1px solid rgba(42,200,255,.2)" }}>
            <span className="text-brand-cyan shrink-0"><Icon name="zap" size={15} /></span>
            <span>Every bill is paid straight from your crypto — no bank app needed.</span>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto no-scrollbar pt-2 flex flex-col">
          {/* provider */}
          <div className="text-[12px] text-white/50 mb-2">Provider</div>
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
            {cat.providers.map((p) => (
              <button key={p} onClick={() => setProvider(p)} className={`h-10 px-4 rounded-[20px] shrink-0 border font-grotesk font-semibold text-[13px] ${provider === p ? "bg-white text-[#07080D] border-white" : "border-white/14 text-white/70"}`}>
                {p}
              </button>
            ))}
          </div>

          <input
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            placeholder={cat.id === "airtime" || cat.id === "data" ? "Phone number" : cat.id === "tv" || cat.id === "electricity" ? "Smartcard / meter number" : "Account / customer ID"}
            className="bg-surface border border-white/[.08] rounded-2xl px-4 h-[52px] outline-none text-[14px] focus:border-brand-cyan/50 mt-4"
          />

          <div className="text-[12px] text-white/50 mt-4 mb-2">Amount</div>
          <div className="grid grid-cols-4 gap-2">
            {cat.amounts.map((a) => (
              <button key={a} onClick={() => setAmount(a)} className={`h-12 rounded-xl border font-grotesk font-semibold text-[13px] ${amount === a ? "bg-brand-cyan/15 border-brand-cyan text-brand-cyan" : "border-white/12 text-white/70"}`}>
                {formatFiat(a, fiat, { decimals: 0 })}
              </button>
            ))}
          </div>
          <input
            value={amount || ""}
            onChange={(e) => setAmount(parseFloat(e.target.value.replace(/[^0-9.]/g, "")) || 0)}
            inputMode="decimal"
            placeholder="Custom amount"
            className="bg-surface border border-white/[.08] rounded-2xl px-4 h-[48px] outline-none text-[14px] focus:border-brand-cyan/50 mt-2 text-center font-grotesk"
          />

          <div className="flex justify-between mt-4 px-1 text-[13px] text-white/55">
            <span>Pays from</span>
            <b className="text-white font-grotesk">≈ {formatCrypto(cost, funding)} {funding}</b>
          </div>

          <div className="flex-1" />
          <div className="pb-6 pt-4">
            <GradientButton onClick={pay} loading={loading} disabled={amount <= 0}>
              Pay {formatFiat(amount, fiat, { decimals: 0 })}
            </GradientButton>
          </div>
        </div>
      )}

      {receipt && (
        <Receipt
          onDone={() => { setReceipt(null); router.push("/home"); }}
          emoji={BILL_CATEGORIES.find((c) => c.title === receipt.category)?.icon ?? "📱"}
          title={`${receipt.category} paid`}
          lines={[`${receipt.provider} · ${receipt.account}`, `Paid ${formatCrypto(receipt.cost, receipt.funding)} ${receipt.funding}`]}
        />
      )}
    </div>
  );
}
