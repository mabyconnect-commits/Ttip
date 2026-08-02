"use client";

import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/context/AppContext";
import { apiGet } from "@/lib/client";
import { BackHeader, Segmented } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { AssetIcon } from "@/components/AssetIcon";
import { AssetPicker } from "@/components/AssetPicker";
import { formatFiat, formatCrypto } from "@/lib/format";
import { CRYPTO_ASSETS } from "@/lib/constants";

interface Rate { symbol: string; buy: number; sell: number }

export default function RatesPage() {
  const { state } = useApp();
  const fiat = state.user.defaultFiat;
  const [tab, setTab] = useState<"rates" | "calc">("rates");
  const [rates, setRates] = useState<Rate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<{ rates: Rate[] }>(`/api/rates?fiat=${fiat}`)
      .then((d) => setRates(d.rates))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [fiat]);

  const bySymbol = useMemo(() => Object.fromEntries(rates.map((r) => [r.symbol, r])), [rates]);

  // calculator state — works both ways.
  //   sell: crypto → fiat (our sell rate)   buy: fiat → crypto (our buy rate)
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState("USDT");
  const [dir, setDir] = useState<"sell" | "buy">("sell");
  const [pick, setPick] = useState(false);
  const amt = parseFloat(amount) || 0;
  const buyRate = bySymbol[from]?.buy ?? 0;
  const sellRate = bySymbol[from]?.sell ?? 0;
  const activeRate = dir === "sell" ? sellRate : buyRate;
  const receive = dir === "sell" ? amt * sellRate : buyRate > 0 ? amt / buyRate : 0;
  const fromAsset = CRYPTO_ASSETS.find((a) => a.symbol === from);
  const assetChip = (
    <button onClick={() => setPick(true)} className="flex items-center gap-2 bg-[#151827] rounded-full px-3 py-[7px] shrink-0">
      <AssetIcon color={fromAsset?.color ?? "#26A17B"} glyph={fromAsset?.glyph ?? "₮"} size={24} />
      <span className="font-grotesk font-semibold text-[14px]">{from}</span>
      <Icon name="chevronDown" size={14} className="text-white/40" />
    </button>
  );
  const fiatChip = <span className="font-grotesk font-semibold text-[14px] bg-[#151827] rounded-full px-4 py-[9px] shrink-0">{fiat}</span>;

  return (
    <div className="flex flex-col flex-1 px-[22px] min-h-0">
      <BackHeader title="Rates" />
      <div className="mt-1">
        <Segmented value={tab} onChange={setTab} options={[{ value: "rates", label: "Rates" }, { value: "calc", label: "Calculator" }]} />
      </div>

      {tab === "rates" ? (
        <div className="flex-1 overflow-y-auto no-scrollbar pt-4 pb-10">
          <div className="flex items-center justify-between px-1 mb-2 text-[11px] font-semibold uppercase tracking-wide text-white/35">
            <span>Asset</span>
            <div className="flex gap-8"><span>Buy</span><span>Sell</span></div>
          </div>
          <div className="flex flex-col gap-1.5">
            {rates.map((r) => {
              const a = CRYPTO_ASSETS.find((x) => x.symbol === r.symbol);
              return (
                <div key={r.symbol} className="flex items-center gap-3 bg-surface border border-white/[.06] rounded-2xl px-4 py-3">
                  <AssetIcon color={a?.color ?? "#26A17B"} glyph={a?.glyph ?? "₮"} size={32} />
                  <div className="flex-1 min-w-0">
                    <div className="font-grotesk font-semibold text-[14px]">{r.symbol}</div>
                    <div className="text-[11px] text-white/40 truncate">{a?.name}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-grotesk font-semibold text-[13.5px]">{formatFiat(r.buy, fiat, { decimals: 0 })}</div>
                  </div>
                  <div className="text-right w-[86px]">
                    <div className="font-grotesk font-semibold text-[13.5px] text-good">{formatFiat(r.sell, fiat, { decimals: 0 })}</div>
                  </div>
                </div>
              );
            })}
            {loading && <div className="text-center text-white/40 text-[13px] py-8">Loading rates…</div>}
            {!loading && rates.length === 0 && <div className="text-center text-white/40 text-[13px] py-8">Rates unavailable right now.</div>}
          </div>
          <div className="mt-4 rounded-2xl px-4 py-3.5 text-[12.5px] leading-[1.55] flex gap-2.5 bg-surface border border-white/[.06] text-white/60">
            <span className="text-good shrink-0"><Icon name="activity" size={16} /></span>
            <span><b className="text-white">Buy</b> is what you pay per coin, <b className="text-white">Sell</b> is what you get. Our rates track the live market and refresh continuously.</span>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto no-scrollbar pt-4 pb-10">
          <div className="relative">
            <div className="bg-surface border border-white/[.08] rounded-[22px] p-[18px]">
              <div className="font-sans text-[12px] text-white/45">You {dir === "sell" ? "sell" : "pay"}</div>
              <div className="flex items-center justify-between mt-2.5 gap-3">
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                  inputMode="decimal"
                  placeholder="0"
                  className="font-grotesk font-bold text-[32px] tracking-[-1px] bg-transparent outline-none w-full min-w-0 placeholder:text-white/25"
                />
                {dir === "sell" ? assetChip : fiatChip}
              </div>
            </div>

            {/* swap direction */}
            <button
              onClick={() => { setDir((d) => (d === "sell" ? "buy" : "sell")); setAmount(""); }}
              className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-ink border border-white/15 flex items-center justify-center text-good z-10 active:scale-95"
              aria-label="Swap direction"
            >
              <Icon name="swapVertical" size={18} />
            </button>

            <div className="bg-surface border border-good/25 rounded-[22px] p-[18px] mt-2.5">
              <div className="font-sans text-[12px] text-white/45">You {dir === "sell" ? "get" : "receive"}</div>
              <div className="flex items-center justify-between mt-2.5 gap-3">
                <div className="font-grotesk font-bold text-[30px] tracking-[-1px] text-good truncate">
                  {dir === "sell" ? formatFiat(receive, fiat, { decimals: 0 }) : formatCrypto(receive, from)}
                </div>
                {dir === "sell" ? fiatChip : assetChip}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2.5 px-1.5 py-4 font-sans text-[13px] text-white/55">
            <div className="flex justify-between"><span>Our rate</span><b className="text-white font-grotesk">1 {from} = {formatFiat(activeRate, fiat)}</b></div>
          </div>

          <p className="text-white/40 text-[12px] px-1 leading-[1.5]">
            {dir === "sell"
              ? `Estimate for ${amt > 0 ? `${formatCrypto(amt, from)} ${from}` : "your crypto"} → ${fiat}. The exact amount is locked when you cash out.`
              : `Estimate for ${amt > 0 ? formatFiat(amt, fiat) : "your naira"} → ${from}. The exact amount is locked when you buy.`}
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
