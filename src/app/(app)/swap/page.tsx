"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { usePrices } from "@/lib/usePrices";
import { apiGet } from "@/lib/client";
import { BackHeader, GradientButton, Sheet } from "@/components/ui";
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
  const [amount, setAmount] = useState("");
  const [pickFrom, setPickFrom] = useState(false);
  const [pickTo, setPickTo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [receipt, setReceipt] = useState<any>(null);
  const [lock, setLock] = useState(60);

  useEffect(() => {
    const t = setInterval(() => setLock((l) => (l <= 1 ? 60 : l - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  const amt = parseFloat(amount) || 0;
  const toIsFiat = isFiatSym(to);
  const fromIsFiat = isFiatSym(from);
  const bal = state.portfolio.assets.find((a) => a.symbol === from)?.amount ?? 0;

  // A crypto↔fiat swap is an off-ramp/on-ramp, so it must use Ttip's official
  // buy/sell rate (margin baked in, no swap fee) — never the raw market price.
  const isOfficial = fromIsFiat !== toIsFiat; // exactly one side is fiat
  const fiatSide = fromIsFiat ? from : to;
  const cryptoSide = fromIsFiat ? to : from;

  // Live official rates for the fiat in play, keyed by crypto symbol.
  const [officialRates, setOfficialRates] = useState<Record<string, { buy: number; sell: number }>>({});
  useEffect(() => {
    if (!isOfficial) return;
    let alive = true;
    apiGet<{ rates: { symbol: string; buy: number; sell: number }[] }>(`/api/rates?fiat=${fiatSide}`)
      .then((d) => {
        if (!alive) return;
        const map: Record<string, { buy: number; sell: number }> = {};
        for (const r of d.rates) map[r.symbol] = { buy: r.buy, sell: r.sell };
        setOfficialRates(map);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [isOfficial, fiatSide]);

  const official = officialRates[cryptoSide];
  const free = !isOfficial && state.user.freeSwapsLeft > 0;

  // Effective "to per 1 from" and the net output for the entered amount.
  let unitToPerFrom: number;
  if (isOfficial) {
    if (fromIsFiat) {
      // fiat → crypto: divide by our buy rate (fiat per 1 crypto).
      unitToPerFrom = official && official.buy > 0 ? 1 / official.buy : 0;
    } else {
      // crypto → fiat: multiply by our sell rate.
      unitToPerFrom = official ? official.sell : 0;
    }
  } else {
    unitToPerFrom = ready ? convert(1, from, to) : 0;
  }
  const gross = amt * unitToPerFrom;
  const net = gross * (1 - (free ? 0 : isOfficial ? 0 : SWAP_FEE_PCT));

  // No rate is not a rate of zero. Showing "You get 0" and "1 NGN = 0 TRX"
  // made a working pair look like a broken one — and, before the confirm step
  // existed, would have taken the money for nothing.
  const noRate = !(unitToPerFrom > 0);

  const fromAsset = CRYPTO_ASSETS.find((a) => a.symbol === from);

  function flip() {
    setFrom(to);
    setTo(from);
  }

  /**
   * A swap is not undoable, so it doesn't happen on one tap.
   *
   * It used to: the button called the API, and a user watched 0.671472 USDT
   * become ₦915.23 with nothing in between — "I click swap e just happen
   * immediately". A conversion at a rate with a margin in it deserves the same
   * beat as every other money screen: see what you pay, see what you get, then
   * agree to it.
   */
  function review() {
    if (amt <= 0) return toast("Enter an amount", "bad");
    if (amt > bal) return toast(`Insufficient ${from} balance`, "bad");
    if (!(unitToPerFrom > 0)) return toast("Rate unavailable — try again in a moment", "bad");
    setConfirming(true);
  }

  async function doSwap() {
    if (amt <= 0 || amt > bal) return;
    setLoading(true);
    try {
      const res: any = await action("/api/swap", { fromSymbol: from, toSymbol: to, amount: amt });
      setConfirming(false);
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
          <span className="font-grotesk font-semibold text-[11px] text-white/50 border border-white/12 rounded-full px-2.5 py-1 whitespace-nowrap tabular-nums">
            {min}:{sec}
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
              placeholder="0"
              className="font-grotesk font-bold text-[36px] tracking-[-1px] bg-transparent outline-none w-full min-w-0 placeholder:text-white/25"
            />
            <button onClick={() => setPickFrom(true)} className="flex items-center gap-2 bg-[#151827] rounded-full px-3 py-[7px] shrink-0">
              {fromIsFiat ? (
                <span className="w-[26px] h-[26px] rounded-full bg-[#0D0F17] flex items-center justify-center text-[15px]">{symLabel(from)}</span>
              ) : (
                <AssetIcon color={fromAsset?.color ?? "#26A17B"} glyph={fromAsset?.glyph ?? "₮"} size={26} />
              )}
              <span className="font-grotesk font-semibold text-[14px]">{from}</span>
              <Icon name="chevronDown" size={14} className="text-white/40" />
            </button>
          </div>
        </div>

        {/* flip */}
        <div className="flex justify-center -my-3 relative z-[2]">
          <button
            onClick={flip}
            aria-label="Flip direction"
            className="w-11 h-11 rounded-full flex items-center justify-center text-white bg-surface2 border-4 border-[#07080D] active:rotate-180 transition-transform"
          >
            <Icon name="swapVertical" size={18} strokeWidth={2} />
          </button>
        </div>

        {/* you get */}
        <div className="bg-surface rounded-[22px] p-[18px] border border-white/[.08]">
          <div className="flex justify-between font-sans text-[12px] text-white/45">
            <span>You get</span>
            <span className="text-good/90">Best rate</span>
          </div>
          <div className="flex items-center justify-between mt-2.5">
            <div className="font-grotesk font-bold text-[32px] tracking-[-1px] text-good truncate">
              {noRate ? <span className="text-white/30">—</span> : toIsFiat ? formatFiat(net, to, { decimals: 0 }) : `${formatCrypto(net, to)}`}
            </div>
            <button onClick={() => setPickTo(true)} className="flex items-center gap-2 bg-[#151827] rounded-full px-3 py-[7px] shrink-0">
              <span className="text-base">{symLabel(to)}</span>
              <span className="font-grotesk font-semibold text-[14px]">{to}</span>
              <Icon name="chevronDown" size={14} className="text-white/40" />
            </button>
          </div>
        </div>

        {/* details */}
        <div className="flex flex-col gap-2.5 px-1.5 py-[18px] font-sans text-[13px] text-white/55">
          <Row label={isOfficial ? "Ttip rate" : "Rate"}>
            <b className="text-white font-grotesk">
              {noRate ? (
                <span className="text-warn">Rate unavailable</span>
              ) : (
                `1 ${from} = ${toIsFiat ? formatFiat(unitToPerFrom, to) : `${formatCrypto(unitToPerFrom, to)} ${to}`}`
              )}
            </b>
          </Row>
          <Row label="Fee">
            <b className="font-grotesk" style={{ color: free || isOfficial ? "#3DF5B0" : "#fff" }}>
              {isOfficial ? "Included in rate" : free ? `Free — ${state.user.freeSwapsLeft} left today` : `${(SWAP_FEE_PCT * 100).toFixed(1)}%`}
            </b>
          </Row>
          {/*
            "Payout to bank" used to sit here as a one-tap toggle. It debited
            the crypto, credited nothing, and marked the transaction as settled
            to the user's bank — while no payout was ever initiated, because
            only /api/send can pay one out. Money in, nothing out.

            A swap now always lands in the Ttip wallet, and cashing out is Send
            out, which has the PIN, the limits and the actual payout.
          */}
          {toIsFiat && (
            <Row label="Goes to">
              <button
                onClick={() => router.push("/send-out")}
                className="font-grotesk font-semibold text-[13px] text-brand-cyan"
              >
                Your {to} balance · cash out →
              </button>
            </Row>
          )}
        </div>
      </div>

      <div className="pb-6 pt-2">
        <GradientButton onClick={review} disabled={amt <= 0 || amt > bal || noRate}>
          {amt > bal
            ? "Insufficient balance"
            : noRate
              ? `No rate for ${to} right now`
              : `Review swap · ${from} → ${to}`}
        </GradientButton>
      </div>

      {/* The beat before it happens. */}
      <Sheet open={confirming} onClose={() => !loading && setConfirming(false)} title="Confirm swap">
        <div className="flex flex-col gap-3">
          <div className="bg-surface border border-white/[.08] rounded-2xl p-4 flex flex-col gap-3">
            <div className="flex justify-between items-baseline">
              <span className="font-sans text-[12.5px] text-white/45">You pay</span>
              <b className="font-grotesk font-bold text-[17px]">
                {fromIsFiat ? formatFiat(amt, from) : `${formatCrypto(amt, from)} ${from}`}
              </b>
            </div>
            <div className="flex justify-between items-baseline">
              <span className="font-sans text-[12.5px] text-white/45">You get</span>
              <b className="font-grotesk font-bold text-[17px] text-good">
                {toIsFiat ? formatFiat(net, to) : `${formatCrypto(net, to)} ${to}`}
              </b>
            </div>
            <div className="h-px bg-white/[.07]" />
            <Row label="Rate">
              <b className="text-white font-grotesk text-[13px]">
                1 {from} = {toIsFiat ? formatFiat(unitToPerFrom, to) : `${formatCrypto(unitToPerFrom, to)} ${to}`}
              </b>
            </Row>
            <Row label="Fee">
              <b className="font-grotesk text-[13px]" style={{ color: free || isOfficial ? "#3DF5B0" : "#fff" }}>
                {isOfficial ? "Included in rate" : free ? "Free" : `${(SWAP_FEE_PCT * 100).toFixed(1)}%`}
              </b>
            </Row>
            <Row label="Goes to">
              <b className="font-grotesk text-[13px]">Your {to} balance</b>
            </Row>
          </div>

          {/* Said plainly, because the number on the receipt can differ from the
              number here and finding that out afterwards feels like a trick. */}
          <p className="font-sans text-[11.5px] text-white/45 leading-[1.5] px-1">
            Rates move. The exact amount is set the moment you confirm and shown on your receipt.
            A swap can&apos;t be undone.
          </p>

          <GradientButton onClick={doSwap} loading={loading}>
            {`Swap ${from} → ${to}`}
          </GradientButton>
          <button
            onClick={() => setConfirming(false)}
            disabled={loading}
            className="h-[46px] rounded-2xl border border-white/12 font-grotesk font-semibold text-[14px] text-white/70 active:scale-[.98] disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      </Sheet>

      <AssetPicker open={pickFrom} onClose={() => setPickFrom(false)} onPick={(s) => { if (s === to) setTo(from); setFrom(s); setPickFrom(false); }} symbols={ALL_SYMS.filter((s) => s !== to)} balances={state.portfolio} title="Swap from" />
      <AssetPicker open={pickTo} onClose={() => setPickTo(false)} onPick={(s) => { if (s === from) setFrom(to); setTo(s); setPickTo(false); }} symbols={ALL_SYMS.filter((s) => s !== from)} balances={state.portfolio} title="Swap to" />

      {receipt && (
        <Receipt
          onDone={() => { setReceipt(null); router.push("/home"); }}
          badge="Swap"
          title="Swapped"
          amount={isFiatSym(receipt.toSymbol)
            ? formatFiat(receipt.amountOut, receipt.toSymbol)
            : `${formatCrypto(receipt.amountOut, receipt.toSymbol)} ${receipt.toSymbol}`}
          fields={[
            { label: "Type", value: "Swap" },
            { label: "Account", value: state.user.name },
            { label: "You sold", value: `${formatCrypto(receipt.amountIn, receipt.fromSymbol)} ${receipt.fromSymbol}` },
            { label: "You got", value: isFiatSym(receipt.toSymbol)
              ? formatFiat(receipt.amountOut, receipt.toSymbol)
              : `${formatCrypto(receipt.amountOut, receipt.toSymbol)} ${receipt.toSymbol}` },
            { label: "Rate", value: `1 ${receipt.fromSymbol} = ${isFiatSym(receipt.toSymbol) ? formatFiat(receipt.rate, receipt.toSymbol) : formatCrypto(receipt.rate, receipt.toSymbol) + " " + receipt.toSymbol}` },
            { label: "Destination", value: receipt.settledToBank ? receipt.destination : `Your ${receipt.toSymbol} balance` },
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
