"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { usePrices } from "@/lib/usePrices";
import { BackHeader, Segmented, GradientButton } from "@/components/ui";
import { CRYPTO_ASSETS, FIATS, NETWORK_FEE_USDT } from "@/lib/constants";
import { formatFiat, formatCrypto } from "@/lib/format";
import { Receipt } from "@/components/Receipt";

const SEND_ASSETS = ["USDT", "USDC", "BTC", "ETH", "SOL", "BNB", "XRP", "TRX"];

export default function SendOutPage() {
  const { state, action, toast } = useApp();
  const { convert } = usePrices();
  const router = useRouter();
  const [mode, setMode] = useState<"bank" | "wallet">("bank");
  const [sym, setSym] = useState("USDT");
  const [amount, setAmount] = useState("");
  const [address, setAddress] = useState("");
  const [bankName, setBankName] = useState("");
  const [account, setAccount] = useState("");
  const [accountName, setAccountName] = useState("");
  const [loading, setLoading] = useState(false);
  const [receipt, setReceipt] = useState<any>(null);

  const amt = parseFloat(amount) || 0;
  const asset = CRYPTO_ASSETS.find((a) => a.symbol === sym);
  const bal = state.portfolio.assets.find((a) => a.symbol === sym)?.amount ?? 0;
  const fiat = state.user.defaultFiat;
  const feeInAsset = convert(NETWORK_FEE_USDT, "USDT", sym);

  async function submit() {
    if (amt <= 0) return toast("Enter an amount", "bad");
    setLoading(true);
    try {
      let body: any;
      if (mode === "wallet") {
        if (!address) { setLoading(false); return toast("Enter a wallet address", "bad"); }
        body = { mode: "wallet", symbol: sym, amount: amt, address, network: asset?.networks[0]?.label };
      } else {
        if (!account) { setLoading(false); return toast("Enter an account number", "bad"); }
        body = { mode: "bank", symbol: sym, amount: amt, fiat, bankName: bankName || "Bank", accountNumber: account, accountName };
      }
      const res: any = await action("/api/send", body);
      setReceipt(res.receipt);
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col flex-1 px-[22px] min-h-0">
      <BackHeader title="Send out" />
      <div className="mt-1">
        <Segmented value={mode} onChange={setMode} options={[{ value: "bank", label: "To bank" }, { value: "wallet", label: "To wallet" }]} />
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar pt-4">
        {/* asset chips */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
          {SEND_ASSETS.map((s) => (
            <button key={s} onClick={() => setSym(s)} className={`h-10 px-4 rounded-[20px] shrink-0 border font-grotesk font-bold text-[13px] transition ${sym === s ? "bg-white text-[#07080D] border-white" : "border-white/14 text-white/70"}`}>
              {s}
            </button>
          ))}
        </div>

        {mode === "wallet" && (
          <div className="bg-surface border border-white/[.08] rounded-2xl px-4 h-[52px] flex items-center gap-2 mt-3">
            <span className="text-white/40">⌘</span>
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Wallet address or scan QR" className="flex-1 bg-transparent outline-none text-[14px]" />
            <button onClick={() => toast("QR scanner opens on device camera", "info")} className="text-brand-cyan text-[13px] font-semibold">Scan</button>
          </div>
        )}

        {mode === "bank" && (
          <div className="flex flex-col gap-2.5 mt-3">
            <input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Bank (e.g. GTBank)" className="bg-surface border border-white/[.08] rounded-2xl px-4 h-[52px] outline-none text-[14px] focus:border-brand-cyan/50" />
            <input value={account} onChange={(e) => setAccount(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" placeholder="Account number" className="bg-surface border border-white/[.08] rounded-2xl px-4 h-[52px] outline-none text-[14px] focus:border-brand-cyan/50" />
            <input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="Account name (optional)" className="bg-surface border border-white/[.08] rounded-2xl px-4 h-[52px] outline-none text-[14px] focus:border-brand-cyan/50" />
          </div>
        )}

        {/* amount */}
        <div className="bg-surface border border-white/[.08] rounded-2xl px-4 py-4 mt-2.5 flex items-center justify-between">
          <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="Amount" className="bg-transparent outline-none text-[26px] font-grotesk font-bold w-full min-w-0" />
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-white/50 font-grotesk font-semibold">{sym}</span>
            <button onClick={() => setAmount(String(bal))} className="text-brand-cyan font-bold text-[13px]">Max</button>
          </div>
        </div>

        <div className="flex flex-col gap-2 mt-4 px-1 text-[13px] text-white/55">
          {mode === "wallet" && (
            <>
              <div className="flex justify-between"><span>Network</span><b className="text-white font-grotesk">{asset?.networks[0]?.label}</b></div>
              <div className="flex justify-between"><span>Network fee</span><b className="text-white font-grotesk">≈ {formatCrypto(feeInAsset, sym)} {sym}</b></div>
            </>
          )}
          {mode === "bank" && amt > 0 && (
            <div className="flex justify-between"><span>They receive</span><b className="text-good font-grotesk">{formatFiat(convert(amt, sym, fiat), fiat)}</b></div>
          )}
          <div className="flex justify-between"><span>Balance</span><b className="text-white font-grotesk">{formatCrypto(bal, sym)} {sym}</b></div>
        </div>
      </div>

      <div className="pb-6 pt-2">
        <GradientButton onClick={submit} loading={loading} disabled={amt <= 0}>
          {mode === "bank" ? "Send to bank" : "Send to wallet"}
        </GradientButton>
      </div>

      {receipt && (
        <Receipt
          onDone={() => { setReceipt(null); router.push("/home"); }}
          emoji={receipt.kind === "wallet" ? "🔗" : "🏦"}
          title={receipt.kind === "wallet" ? `${formatCrypto(receipt.amount, receipt.symbol)} ${receipt.symbol} sent` : `${formatFiat(receipt.fiatAmount, receipt.fiat)} on the way`}
          lines={receipt.kind === "wallet"
            ? [`To ${receipt.address.slice(0, 10)}…${receipt.address.slice(-6)}`, `via ${receipt.network} · fee ${formatCrypto(receipt.fee, receipt.symbol)} ${receipt.symbol}`, "Track it in activity"]
            : [`To ${receipt.bank}`, `Debited ${formatCrypto(receipt.amount, receipt.symbol)} ${receipt.symbol}`, "Instant payout ⚡"]}
        />
      )}
    </div>
  );
}
