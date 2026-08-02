"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { usePrices } from "@/lib/usePrices";
import { BackHeader, GradientButton } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { formatFiat, formatCrypto } from "@/lib/format";
import { Receipt } from "@/components/Receipt";
import { TestModeBanner } from "@/components/TestModeBanner";

const BUY_ASSETS = ["USDT", "USDC", "BTC", "ETH", "SOL", "BNB", "TRX"];
const QUICK = [5000, 10000, 20000, 50000];

export default function BuyPage() {
  const { state, action, toast } = useApp();
  const { convert } = usePrices();
  const router = useRouter();
  const [sym, setSym] = useState("USDT");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [receipt, setReceipt] = useState<any>(null);

  const fiat = state.user.defaultFiat;
  const verified = state.user.kycStatus === "verified";
  const fiatAmt = parseFloat(amount) || 0;
  // Indicative estimate (server locks the real quote with margin on submit).
  const estCrypto = fiatAmt > 0 ? convert(fiatAmt, fiat, sym) : 0;

  async function submit() {
    if (fiatAmt <= 0) return toast("Enter an amount", "bad");
    if (!verified) { router.push("/account/kyc"); return toast("Verify your BVN to buy crypto", "info"); }
    setLoading(true);
    try {
      const res: any = await action("/api/buy", { symbol: sym, fiat, fiatAmount: fiatAmt });
      const buy = res.buy;
      if (buy?.status === "pending" && buy.checkoutUrl) {
        // Live: hand off to the hosted checkout to complete payment.
        window.location.href = buy.checkoutUrl;
        return;
      }
      setReceipt(buy);
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col flex-1 px-[22px] min-h-0">
      <BackHeader title="Buy crypto" />

      {!verified && (
        <button onClick={() => router.push("/account/kyc")} className="mt-3 w-full rounded-2xl bg-surface border border-white/[.08] px-4 py-3 flex items-center gap-3 text-left active:scale-[.99]">
          <span className="w-8 h-8 rounded-full bg-good/12 flex items-center justify-center text-good shrink-0"><Icon name="shield" size={16} /></span>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-[13px]">Verify your BVN to buy</div>
            <div className="text-white/45 text-[11.5px]">Required before you can buy or move crypto</div>
          </div>
          <Icon name="chevronRight" size={15} className="text-white/30" />
        </button>
      )}

      <div className="flex-1 overflow-y-auto no-scrollbar pt-4">
        <TestModeBanner />
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
          {BUY_ASSETS.map((s) => (
            <button key={s} onClick={() => setSym(s)} className={`h-10 px-4 rounded-[20px] shrink-0 border font-grotesk font-bold text-[13px] transition ${sym === s ? "bg-white text-[#07080D] border-white" : "border-white/14 text-white/70"}`}>
              {s}
            </button>
          ))}
        </div>

        <div className="bg-surface border border-white/[.08] rounded-2xl px-4 py-4 mt-2.5 flex items-center justify-between">
          <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="0" className="bg-transparent outline-none text-[26px] font-grotesk font-bold w-full min-w-0" />
          <span className="text-white/50 font-grotesk font-semibold shrink-0">{fiat}</span>
        </div>

        <div className="grid grid-cols-4 gap-2 mt-2.5">
          {QUICK.map((q) => (
            <button key={q} onClick={() => setAmount(String(q))} className="h-9 rounded-xl bg-surface border border-white/[.08] text-[12px] text-white/70 font-grotesk font-semibold">
              {formatFiat(q, fiat, { decimals: 0 })}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2 mt-4 px-1 text-[13px] text-white/55">
          <div className="flex justify-between"><span>You get (approx.)</span><b className="text-good font-grotesk">≈ {formatCrypto(estCrypto, sym)} {sym}</b></div>
          <div className="flex justify-between"><span>Pay with</span><b className="text-white font-grotesk">Card / bank transfer</b></div>
        </div>

        <p className="text-white/35 text-[11.5px] mt-4 px-1 leading-[1.5]">
          The exact rate is locked when you pay. Crypto lands in your wallet as soon as the payment confirms.
        </p>
      </div>

      <div className="pb-6 pt-2">
        <GradientButton onClick={submit} loading={loading} disabled={fiatAmt <= 0}>
          {verified ? `Buy ${sym}` : "Verify to buy"}
        </GradientButton>
      </div>

      {receipt && (
        <Receipt
          onDone={() => { setReceipt(null); router.push("/home"); }}
          emoji="🛒"
          title={`${formatCrypto(receipt.amountAsset, receipt.symbol)} ${receipt.symbol} added`}
          lines={[
            `Paid ${formatFiat(receipt.fiatAmount, receipt.fiat)}`,
            `Rate ${formatFiat(receipt.rate, receipt.fiat)} / ${receipt.symbol}`,
          ]}
        />
      )}
    </div>
  );
}
