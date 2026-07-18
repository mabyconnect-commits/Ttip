"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { usePrices } from "@/lib/usePrices";
import { BackHeader, Sheet, GradientButton, grad } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { AssetIcon } from "@/components/AssetIcon";
import { formatFiat, formatCrypto } from "@/lib/format";
import { CRYPTO_ASSETS, FIATS, SWAP_FEE_PCT } from "@/lib/constants";
import { Receipt } from "@/components/Receipt";
import { AssetPicker } from "@/components/AssetPicker";

const CRYPTO_SYMS = CRYPTO_ASSETS.map((a) => a.symbol);
const ALL_SYMS = [...CRYPTO_SYMS, ...FIATS.map((f) => f.code)];
const isFiatSym = (s: string) => FIATS.some((f) => f.code === s);
const symLabel = (s: string) => (isFiatSym(s) ? FIATS.find((f) => f.code === s)?.flag ?? "" : CRYPTO_ASSETS.find((a) => a.symbol === s)?.glyph ?? "");

export default function SwapPage() {
  const { state, action, toast } = useApp();
  const { convert, ready } = usePrices();
  const router = useRouter();
  const params = useSearchParams();

  const [from, setFrom] = useState(params.get("from") || "USDT");
  const [to, setTo] = useState(state.user.defaultFiat);
  const [amount, setAmount] = useState("250");
  const [payoutToBank, setPayoutToBank] = useState(false);
  const [pickFrom, setPickFrom] = useState(false);
  const [pickTo, setPickTo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [receipt, setReceipt] = useState<any>(null);
  const [lock, setLock] = useState(60);

  useEffect(() => {
    const t = setInterval(() => setLock((l) => (l <= 1 ? 60 : l - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  const amt = parseFloat(amount) || 0;
  const gross = ready ? convert(amt, from, to) : 0;
  const free = state.user.freeSwapsLeft > 0;
  const net = gross * (1 - (free ? 0 : SWAP_FEE_PCT));
  const bal = state.portfolio.assets.find((a) => a.symbol === from)?.amount ?? 0;
  const toIsFiat = isFiatSym(to);
  const fromIsFiat = isFiatSym(from);

  const fromAsset = CRYPTO_ASSETS.find((a) => a.symbol === from);

  function flip() {
    setFrom(to);
    setTo(from);
    setPayoutToBank(false);
  }

  async function doSwap() {
    if (amt <= 0) return toast("Enter an amount", "bad");
    if (amt > bal) return toast(`Insufficient ${from} balance`, "bad");
    setLoading(true);
    try {
      const res: any = await action("/api/swap", { fromSymbol: from, toSymbol: to, amount: amt, payoutToBank: toIsFiat && payoutToBank });
      setReceipt(res.receipt);
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setLoading(false);
    }
  }

  const min = String(Math.floor(lock / 60));
  const sec = String(lock % 60).padStart(2, "0");

  return (
    <div className="flex flex-col flex-1 px-5 min-h-0">
      <BackHeader
        title="Swap"
        right={
          <span className="font-grotesk font-semibold text-[11px] text-good border border-good/35 rounded-xl px-2.5 py-1 whitespace-nowrap">
            ⏱ {min}:{sec}
          </span>
        }
      />

      <div className="flex-1 overflow-y-auto no-scrollbar">
        {/* you send */}
        <div className="bg-surface border border-white/[.08] rounded-[22px] p-[18px]">
          <div className="flex justify-between font-sans text-[12px] text-white/45">
            <span>You send</span>
            <span>
              Balance: {formatCrypto(bal, from)} {from} ·{" "}
              <button className="text-brand-cyan font-bold" onClick={() => setAmount(String(bal))}>
                Max
              </button>
            </span>
          </div>
          <div className="flex items-center justify-between mt-2.5">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              inputMode="decimal"
              className="font-grotesk font-bold text-[36px] tracking-[-1px] bg-transparent outline-none w-full min-w-0"
            />
            <button onClick={() => setPickFrom(true)} className="flex items-center gap-2 bg-[#151827] rounded-[20px] px-3 py-[7px] shrink-0">
              {fromIsFiat ? (
                <span className="w-[26px] h-[26px] rounded-full bg-[#0D0F17] flex items-center justify-center text-[15px]">{symLabel(from)}</span>
              ) : (
                <AssetIcon color={fromAsset?.color ?? "#26A17B"} glyph={fromAsset?.glyph ?? "₮"} size={26} />
              )}
              <span className="font-grotesk font-semibold text-[14px]">{from}</span>
              <span className="text-white/40">▾</span>
            </button>
          </div>
        </div>

        {/* flip */}
        <div className="flex justify-center -my-3 relative z-[2]">
          <button
            onClick={flip}
            aria-label="Flip direction"
            className="w-11 h-11 rounded-[22px] flex items-center justify-center text-[#04121A] border-4 border-[#07080D] active:rotate-180 transition-transform"
            style={{ background: grad("135deg,#6D5BFF,#2AC8FF 60%,#3DF5B0") }}
          >
            <Icon name="swapVertical" size={18} strokeWidth={2.4} />
          </button>
        </div>

        {/* you get */}
        <div className="bg-surface rounded-[22px] p-[18px] border border-good/25">
          <div className="flex justify-between font-sans text-[12px] text-white/45">
            <span>You get</span>
            <span className="text-good">Best rate on the street 🏆</span>
          </div>
          <div className="flex items-center justify-between mt-2.5">
            <div className="font-grotesk font-bold text-[32px] tracking-[-1px] text-good truncate">
              {toIsFiat ? formatFiat(net, to, { decimals: 0 }) : `${formatCrypto(net, to)}`}
            </div>
            <button onClick={() => setPickTo(true)} className="flex items-center gap-2 bg-[#151827] rounded-[20px] px-3 py-[7px] shrink-0">
              <span className="text-base">{symLabel(to)}</span>
              <span className="font-grotesk font-semibold text-[14px]">{to}</span>
              <span className="text-white/40">▾</span>
            </button>
          </div>
          <div className="flex gap-1.5 mt-3 flex-wrap">
            {(fromIsFiat ? CRYPTO_SYMS.slice(0, 5) : FIATS.map((f) => f.code)).filter((s) => s !== to && s !== from).map((s) => (
              <button key={s} onClick={() => setTo(s)} className="font-grotesk font-medium text-[10.5px] text-white/50 border border-white/12 rounded-[10px] px-2 py-[3px]">
                {symLabel(s)} {s}
              </button>
            ))}
          </div>
        </div>

        {/* details */}
        <div className="flex flex-col gap-2.5 px-1.5 py-[18px] font-sans text-[13px] text-white/55">
          <Row label="Rate">
            <b className="text-white font-grotesk">
              1 {from} = {toIsFiat ? formatFiat(convert(1, from, to), to) : `${formatCrypto(convert(1, from, to), to)} ${to}`}
            </b>
          </Row>
          <Row label="Fee">
            <b className="font-grotesk" style={{ color: free ? "#3DF5B0" : "#fff" }}>
              {free ? `Free — ${state.user.freeSwapsLeft} left today` : `${(SWAP_FEE_PCT * 100).toFixed(1)}%`}
            </b>
          </Row>
          {toIsFiat && (
            <Row label="Payout to">
              <button onClick={() => setPayoutToBank((v) => !v)} className="font-grotesk font-semibold text-[13px]" style={{ color: payoutToBank ? "#3DF5B0" : "#2AC8FF" }}>
                {payoutToBank ? `${state.user.bankAccount} · instant ⚡` : "Ttip wallet ▾"}
              </button>
            </Row>
          )}
        </div>
      </div>

      <div className="pb-6 pt-2">
        <GradientButton onClick={doSwap} loading={loading} disabled={amt <= 0 || amt > bal}>
          {amt > bal ? "Insufficient balance" : `Swap ${from} → ${to} · settles in ~5s`}
        </GradientButton>
      </div>

      <AssetPicker open={pickFrom} onClose={() => setPickFrom(false)} onPick={(s) => { if (s === to) setTo(from); setFrom(s); setPickFrom(false); }} symbols={ALL_SYMS.filter((s) => s !== to)} balances={state.portfolio} title="Swap from" />
      <AssetPicker open={pickTo} onClose={() => setPickTo(false)} onPick={(s) => { if (s === from) setFrom(to); setTo(s); setPickTo(false); }} symbols={ALL_SYMS.filter((s) => s !== from)} balances={state.portfolio} title="Swap to" />

      {receipt && (
        <Receipt
          onDone={() => { setReceipt(null); router.push("/home"); }}
          title={`${formatCrypto(receipt.amountIn, receipt.fromSymbol)} ${receipt.fromSymbol} swapped`}
          emoji="🔄"
          lines={[
            `You got ${isFiatSym(receipt.toSymbol) ? formatFiat(receipt.amountOut, receipt.toSymbol) : formatCrypto(receipt.amountOut, receipt.toSymbol) + " " + receipt.toSymbol}`,
            `Rate 1 ${receipt.fromSymbol} = ${isFiatSym(receipt.toSymbol) ? formatFiat(receipt.rate, receipt.toSymbol) : formatCrypto(receipt.rate, receipt.toSymbol) + " " + receipt.toSymbol}`,
            receipt.settledToBank ? `Paid to ${receipt.destination}` : `Added to your ${receipt.toSymbol} balance`,
          ]}
        />
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      {children}
    </div>
  );
}
