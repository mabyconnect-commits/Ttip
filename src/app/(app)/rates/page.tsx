"use client";

import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { usePrices } from "@/lib/usePrices";
import { BackHeader, Segmented } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { AssetIcon } from "@/components/AssetIcon";
import { AssetPicker } from "@/components/AssetPicker";
import { formatFiat, formatCrypto } from "@/lib/format";
import { CRYPTO_ASSETS } from "@/lib/constants";

const RATE_ASSETS = ["USDT", "USDC", "BTC", "ETH", "SOL", "BNB"];

export default function RatesPage() {
  const { state } = useApp();
  const { convert, ready } = usePrices();
  const fiat = state.user.defaultFiat;
  const [tab, setTab] = useState<"rates" | "calc">("rates");

  // calculator state
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState("USDT");
  const [pick, setPick] = useState(false);
  const amt = parseFloat(amount) || 0;
  const receive = ready ? convert(amt, from, fiat) : 0;
  const rate = ready ? convert(1, from, fiat) : 0;
  const fromAsset = CRYPTO_ASSETS.find((a) => a.symbol === from);

  return (
    <div className="flex flex-col flex-1 px-[22px] min-h-0">
      <BackHeader title="Rates" />
      <div className="mt-1">
        <Segmented value={tab} onChange={setTab} options={[{ value: "rates", label: "Rates" }, { value: "calc", label: "Calculator" }]} />
      </div>

      {tab === "rates" ? (
        <div className="flex-1 overflow-y-auto no-scrollbar pt-4 pb-10">
          <div className="flex flex-col gap-1.5">
            {RATE_ASSETS.map((s) => {
              const a = CRYPTO_ASSETS.find((x) => x.symbol === s);
              return (
                <div key={s} className="flex items-center gap-3 bg-surface border border-white/[.06] rounded-2xl px-4 py-3.5">
                  <AssetIcon color={a?.color ?? "#26A17B"} glyph={a?.glyph ?? "₮"} size={34} />
                  <div className="flex-1">
                    <div className="font-grotesk font-semibold text-[14px]">{s}</div>
                    <div className="text-[11.5px] text-white/40">{a?.name}</div>
                  </div>
                  <div className="font-grotesk font-semibold text-[14px] text-good">
                    {ready ? `1 ${s} = ${formatFiat(convert(1, s, fiat), fiat, { decimals: 0 })}` : "…"}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 rounded-2xl px-4 py-3.5 text-[12.5px] leading-[1.55] flex gap-2.5" style={{ background: "rgba(42,200,255,.08)", border: "1px solid rgba(42,200,255,.25)", color: "rgba(255,255,255,.75)" }}>
            <span className="text-brand-cyan shrink-0"><Icon name="activity" size={16} /></span>
            <span>Rates track the live market and refresh continuously, so your crypto converts at the best available rate.</span>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto no-scrollbar pt-4 pb-10">
          <div className="bg-surface border border-white/[.08] rounded-[22px] p-[18px]">
            <div className="font-sans text-[12px] text-white/45">You send</div>
            <div className="flex items-center justify-between mt-2.5">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal"
                placeholder="0"
                className="font-grotesk font-bold text-[34px] tracking-[-1px] bg-transparent outline-none w-full min-w-0 placeholder:text-white/25"
              />
              <button onClick={() => setPick(true)} className="flex items-center gap-2 bg-[#151827] rounded-full px-3 py-[7px] shrink-0">
                <AssetIcon color={fromAsset?.color ?? "#26A17B"} glyph={fromAsset?.glyph ?? "₮"} size={24} />
                <span className="font-grotesk font-semibold text-[14px]">{from}</span>
                <Icon name="chevronDown" size={14} className="text-white/40" />
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2.5 px-1.5 py-4 font-sans text-[13px] text-white/55">
            <div className="flex justify-between"><span>Exchange rate</span><b className="text-white font-grotesk">1 {from} = {formatFiat(rate, fiat)}</b></div>
          </div>

          <div className="bg-surface border border-good/25 rounded-[22px] p-[18px]">
            <div className="font-sans text-[12px] text-white/45">You receive (est.)</div>
            <div className="font-grotesk font-bold text-[32px] tracking-[-1px] text-good mt-1.5">{formatFiat(receive, fiat, { decimals: 0 })}</div>
          </div>

          <p className="text-white/40 text-[12px] mt-3 px-1 leading-[1.5]">
            Estimate for {amt > 0 ? `${formatCrypto(amt, from)} ${from}` : "your crypto"} → {fiat}. The exact amount is locked when you swap.
          </p>

          <AssetPicker
            open={pick}
            onClose={() => setPick(false)}
            onPick={(s) => { setFrom(s); setPick(false); }}
            symbols={CRYPTO_ASSETS.map((a) => a.symbol)}
            balances={state.portfolio}
            title="Choose asset"
          />
        </div>
      )}
    </div>
  );
}
