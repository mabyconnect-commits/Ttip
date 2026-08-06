"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { apiGet, apiPost } from "@/lib/client";
import { usePrices } from "@/lib/usePrices";
import { BackHeader, Segmented, GradientButton, Sheet } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { withdrawFeeUsd } from "@/lib/constants";
import { sortChainsByPopularity } from "@/lib/chains";
import { transferFee } from "@/lib/pricing";
import { formatFiat, formatCrypto } from "@/lib/format";
import { Receipt } from "@/components/Receipt";
import { BankPicker } from "@/components/BankPicker";
import { QrScanner } from "@/components/QrScanner";
import { TestModeBanner } from "@/components/TestModeBanner";
import { PinPrompt } from "@/components/PinPrompt";
import { cleanNarration, NARRATION_MAX } from "@/lib/narration";
import { planFunding } from "@/lib/funding-plan";
import type { Bank } from "@/lib/banks";

// Crypto sellable to a bank. The user's own fiat is prepended at render time —
// see `bankAssets` below — because someone holding naira has to be able to send
// naira to a bank without swapping it into crypto and back first.
const BANK_CRYPTO = ["USDT", "USDC", "BTC", "ETH", "SOL", "BNB", "XRP", "TRX"];

interface DxChain { chainId: number; name: string }
interface DxToken { symbol: string; name: string }

export default function SendOutPage() {
  const { state, action, toast } = useApp();
  const { convert, ready: pricesReady } = usePrices();
  const router = useRouter();
  const [mode, setMode] = useState<"bank" | "wallet">("bank");
  const [sym, setSym] = useState(""); // bank-mode asset; defaulted once state loads
  const [amount, setAmount] = useState("");
  const [address, setAddress] = useState("");
  const [bank, setBank] = useState<Bank | null>(null);
  const [bankOpen, setBankOpen] = useState(false);
  const [account, setAccount] = useState("");
  const [accountName, setAccountName] = useState("");
  const [note, setNote] = useState("");
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [receipt, setReceipt] = useState<any>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinError, setPinError] = useState(false);
  // One id per attempt. Re-taps reuse it, so the server refuses the duplicate.
  const [attemptKey, setAttemptKey] = useState("");

  // Wallet-mode: pick any chain → any token Dextopus supports (like the deposit
  // picker). Falls back to a hardcoded list when Dextopus isn't configured (demo).
  const [chains, setChains] = useState<DxChain[]>([]);
  const [tokens, setTokens] = useState<DxToken[]>([]);
  const [selChain, setSelChain] = useState<DxChain | null>(null);
  const [selToken, setSelToken] = useState<DxToken | null>(null);
  const [chainSheet, setChainSheet] = useState(false);
  const [tokenSheet, setTokenSheet] = useState(false);
  const [chainQ, setChainQ] = useState("");
  const [tokenQ, setTokenQ] = useState("");
  const [previewOut, setPreviewOut] = useState<number | null>(null);
  const [previewMsg, setPreviewMsg] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    apiGet<{ chains: DxChain[] }>("/api/deposit/chains").then((d) => setChains(d.chains ?? [])).catch(() => {});
  }, []);

  async function pickChain(c: DxChain) {
    setSelChain(c); setChainSheet(false); setChainQ("");
    setSelToken(null); setTokens([]);
    try {
      const d = await apiGet<{ tokens: DxToken[] }>(`/api/deposit/tokens?chainId=${c.chainId}`);
      setTokens(d.tokens ?? []);
    } catch { setTokens([]); }
  }

  // Auto-resolve the bank account holder's name once a bank + 10-digit NUBAN is set.
  useEffect(() => {
    setResolvedName(null);
    if (mode !== "bank" || !bank || account.length !== 10) return;
    let cancelled = false;
    setResolving(true);
    const t = setTimeout(async () => {
      try {
        const r = await apiPost<{ accountName: string | null }>("/api/resolve-account", { bankName: bank.name, accountNumber: account, currency: state.user.defaultFiat });
        if (!cancelled) setResolvedName(r.accountName);
      } catch {
        if (!cancelled) setResolvedName(null);
      } finally {
        if (!cancelled) setResolving(false);
      }
    }, 500);
    return () => { cancelled = true; clearTimeout(t); };
  }, [mode, bank, account, state.user.defaultFiat]);

  const verified = state.user.kycStatus === "verified";
  const amt = parseFloat(amount) || 0;
  const fiat = state.user.defaultFiat;

  // Cash-out sources: the user's own fiat first (a naira balance goes straight
  // to a bank — no spread, just the transfer fee), then the crypto rails.
  const fiatBal = state.portfolio.assets.find((a) => a.symbol === fiat)?.amount ?? 0;
  const bankAssets = [fiat, ...BANK_CRYPTO.filter((s) => s !== fiat)];

  // Default to naira when they hold naira; otherwise the usual USDT.
  useEffect(() => {
    if (sym) return;
    setSym(fiatBal > 0 ? fiat : "USDT");
  }, [sym, fiat, fiatBal]);

  /**
   * Everything a bank payout can draw on, valued in the payout currency.
   *
   * A payout is funded from EVERY wallet at once — naira first, then crypto,
   * sold as part of the send (see lib/funding-plan.ts). The screen didn't know
   * that: it measured the amount against the ONE wallet in the chips, so a user
   * holding USDC and no naira was told "No NGN to send" and went and swapped by
   * hand — paying a spread for a conversion the send would have done for free.
   * That seamlessness is the feature; this is the number it runs on.
   */
  const spendableWallets = state.portfolio.assets
    .filter((a) => a.amount > 0)
    .map((a) => ({ symbol: a.symbol, amount: a.amount, fiat: convert(a.amount, a.symbol, fiat) }))
    .filter((w) => w.fiat > 0)
    .sort((a, b) => b.fiat - a.fiat);
  const spendableTotal = spendableWallets.reduce((sum, w) => sum + w.fiat, 0);

  // Preview of which wallets will pay, using the same planner the server runs.
  // Purely informational — the server plans again from real balances.
  const fundingPlan = (() => {
    if (mode !== "bank" || amt <= 0 || !sym) return null;
    const sources = state.portfolio.assets
      .filter((a) => a.amount > 0)
      .map((a) => ({ symbol: a.symbol, amount: a.amount, fiatPerUnit: convert(1, a.symbol, fiat) }))
      .filter((a) => a.fiatPerUnit > 0);
    const sending = convert(amt, sym, fiat);
    const fee = transferFee(sending, fiat) ?? 0;
    return planFunding(sending + fee, sources, sym);
  })();
  // Only worth showing when more than one wallet is involved.
  const splitFunding = !!fundingPlan?.ok && (fundingPlan?.legs.length ?? 0) > 1;

  /**
   * Short for a BANK send means short across every wallet, not one of them.
   *
   * Only judged once prices are in: before that the crypto legs convert to zero
   * and the plan looks short, and a false "you can't afford this" is the very
   * bug being fixed. Until then the tap is allowed and the server — which plans
   * again from real balances — has the final word.
   */
  const bankShort = mode === "bank" && pricesReady && !!fundingPlan && !fundingPlan.ok;

  // The active asset + destination differ by mode.
  const walletSym = selToken?.symbol ?? "";
  const activeSym = mode === "wallet" ? walletSym : sym;
  const bal = state.portfolio.assets.find((a) => a.symbol === activeSym)?.amount ?? 0;
  // A crypto send really is one wallet: you cannot send USDT out of SOL.
  const walletShort = mode === "wallet" && amt > bal;
  // Withdrawal fee: max(0.8%, $0.50). Fee shown scales with the entered amount.
  const feeUsd = activeSym ? withdrawFeeUsd(convert(amt, activeSym, "USDT")) : 0;
  const feeInAsset = activeSym ? convert(feeUsd, "USDT", activeSym) : 0;
  // Max must leave room for the fee — size it off the fee on the full balance.
  const maxFeeInAsset = activeSym ? convert(withdrawFeeUsd(convert(bal, activeSym, "USDT")), "USDT", activeSym) : 0;
  const maxSendable = Math.max(0, bal - maxFeeInAsset); // Max must leave room for the fee
  // Max on a bank send must leave room for the fee that now sits on top, or
  // tapping Max always comes up short. Expressed in the chosen asset.
  const maxBankSend = (() => {
    if (mode !== "bank" || !sym) return 0;
    const unit = convert(1, sym, fiat);
    if (!(unit > 0)) return bal;
    // Across every wallet, for the same reason the button is: Max on a screen
    // that spends all of them must offer all of them.
    const availableFiat = spendableTotal;
    // Two passes: the fee tier depends on the amount, which depends on the fee.
    const first = availableFiat - (transferFee(availableFiat, fiat) ?? 0);
    const send = availableFiat - (transferFee(Math.max(0, first), fiat) ?? 0);
    return Math.max(0, send / unit);
  })();

  // Live preview of what actually arrives (real cross-chain + network fees),
  // debounced. Only for wallet sends once a chain, token, address and amount exist.
  useEffect(() => {
    setPreviewOut(null); setPreviewMsg(null);
    if (mode !== "wallet" || !selChain || !selToken || address.length < 8 || amt <= 0) return;
    let cancelled = false;
    setPreviewing(true);
    const t = setTimeout(async () => {
      try {
        const r = await apiPost<{ ok: boolean; amountOut?: number; message?: string }>("/api/withdraw/preview", { symbol: walletSym, chainId: selChain.chainId, network: selChain.name, address, amount: amt });
        if (cancelled) return;
        if (r.ok && typeof r.amountOut === "number") { setPreviewOut(r.amountOut); setPreviewMsg(null); }
        else { setPreviewOut(null); setPreviewMsg(r.message ?? "This withdrawal can't be processed."); }
      } catch (e: any) {
        if (!cancelled) { setPreviewOut(null); setPreviewMsg(null); }
      } finally {
        if (!cancelled) setPreviewing(false);
      }
    }, 650);
    return () => { cancelled = true; clearTimeout(t); };
  }, [mode, selChain, selToken, address, amt, walletSym]);

  /** Validate, then ask for the PIN. The transfer itself runs in `send`. */
  function submit() {
    if (amt <= 0) return toast("Enter an amount", "bad");
    if (!verified) { router.push("/account/kyc"); return toast("Verify your BVN to withdraw", "info"); }
    if (mode === "wallet") {
      if (!selChain || !selToken) return toast("Choose a network and asset", "bad");
      if (!address) return toast("Enter a wallet address", "bad");
    } else {
      if (!bank) return toast("Choose a bank", "bad");
      if (!account) return toast("Enter an account number", "bad");
    }
    setPinError(false);
    setAttemptKey(
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    setPinOpen(true);
  }

  async function send(pin: string) {
    if (loading) return; // a second tap must never start a second transfer
    setLoading(true);
    try {
      let body: any;
      if (mode === "wallet") {
        if (amt + feeInAsset > bal + 1e-12) { setLoading(false); return toast(`Not enough ${walletSym} to cover amount + fee`, "bad"); }
        body = { mode: "wallet", symbol: walletSym, amount: amt, address, network: selChain!.name, chainId: selChain!.chainId, pin, idempotencyKey: attemptKey };
      } else {
        body = { mode: "bank", symbol: sym, amount: amt, fiat, bankName: bank!.name, accountNumber: account, accountName: resolvedName ?? accountName, note: cleanNarration(note) || undefined, pin, idempotencyKey: attemptKey };
      }
      const res: any = await action("/api/send", body);
      setPinOpen(false);
      setReceipt(res.receipt);
    } catch (e: any) {
      // A rejected PIN keeps the pad open so they can try again. If the server
      // asked for a PIN we didn't send, show the pad instead of just a toast.
      if (/pin/i.test(e.message ?? "")) {
        setPinError(true);
        setPinOpen(true);
      } else setPinOpen(false);
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

      {/* No PIN, no withdrawal — say so here rather than letting them fill in the
          whole form and fail on the last tap. */}
      {verified && !state.user.hasPin && (
        <button onClick={() => router.push("/account/security")} className="mt-3 w-full rounded-2xl bg-surface border border-warn/25 px-4 py-3 flex items-center gap-3 text-left active:scale-[.99]">
          <span className="w-8 h-8 rounded-full bg-warn/[.12] flex items-center justify-center text-warn shrink-0"><Icon name="lock" size={16} /></span>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-[13px]">Set a transaction PIN to withdraw</div>
            <div className="text-white/45 text-[11.5px]">Takes a minute · Account → Security</div>
          </div>
          <Icon name="chevronRight" size={15} className="text-white/30" />
        </button>
      )}

      {!verified && (
        <button onClick={() => router.push("/account/kyc")} className="mt-3 w-full rounded-2xl bg-surface border border-white/[.08] px-4 py-3 flex items-center gap-3 text-left active:scale-[.99]">
          <span className="w-8 h-8 rounded-full bg-good/12 flex items-center justify-center text-good shrink-0"><Icon name="shield" size={16} /></span>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-[13px]">Verify your BVN to withdraw</div>
            <div className="text-white/45 text-[11.5px]">Required before money can leave your account · takes a minute</div>
          </div>
          <Icon name="chevronRight" size={15} className="text-white/30" />
        </button>
      )}

      <div className="flex-1 overflow-y-auto no-scrollbar pt-4">
        <TestModeBanner />

        {mode === "bank" && (
          <>
            {/* asset chips (crypto to sell to fiat) */}
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
              {bankAssets.map((s) => (
                <button key={s} onClick={() => setSym(s)} className={`h-10 px-4 rounded-[20px] shrink-0 border font-grotesk font-bold text-[13px] transition ${sym === s ? "bg-white text-[#07080D] border-white" : "border-white/14 text-white/70"}`}>
                  {s}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-2.5 mt-3">
              <button onClick={() => setBankOpen(true)} className="bg-surface border border-white/[.08] rounded-2xl px-4 h-[52px] flex items-center justify-between text-[14px] active:scale-[.99]">
                <span className={bank ? "text-white font-medium" : "text-white/35"}>{bank ? bank.name : "Choose bank"}</span>
                <Icon name="chevronDown" size={15} className="text-white/40" />
              </button>
              <input value={account} onChange={(e) => setAccount(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" maxLength={10} placeholder="Account number" className="bg-surface border border-white/[.08] rounded-2xl px-4 h-[52px] outline-none text-[14px] focus:border-brand-cyan/50" />
              {resolving ? (
                <div className="bg-surface border border-white/[.08] rounded-2xl px-4 h-[52px] flex items-center gap-2 text-[13.5px] text-white/45">
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-white/20 border-t-white/60 animate-spin" /> Checking account…
                </div>
              ) : resolvedName ? (
                <div className="bg-good/[.08] border border-good/25 rounded-2xl px-4 h-[52px] flex items-center gap-2.5">
                  <Icon name="check" size={16} strokeWidth={2.6} className="text-good shrink-0" />
                  <span className="text-[14px] font-medium text-white truncate">{resolvedName}</span>
                </div>
              ) : (
                <input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="Account name (optional)" className="bg-surface border border-white/[.08] rounded-2xl px-4 h-[52px] outline-none text-[14px] focus:border-brand-cyan/50" />
              )}

              {/* The narration. It lands on the recipient's bank statement, which
                  is how they work out who paid for what — every transfer going
                  out as "Ttip payout" made them all look identical. */}
              <div>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, NARRATION_MAX))}
                  placeholder="What's this for? (optional)"
                  className="w-full bg-surface border border-white/[.08] rounded-2xl px-4 h-[52px] outline-none text-[14px] focus:border-brand-cyan/50"
                />
                <div className="flex justify-between px-1.5 mt-1">
                  <span className="text-[11px] text-white/35">Shows on their statement</span>
                  {note.length > 0 && (
                    <span className="text-[11px] text-white/35">{note.length}/{NARRATION_MAX}</span>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {mode === "wallet" && (
          <>
            {/* network + asset — any of Dextopus's 70+ chains and their tokens */}
            <button onClick={() => setChainSheet(true)} className="w-full flex items-center justify-between bg-surface border border-white/[.08] rounded-2xl px-4 h-[54px] active:scale-[.99]">
              <span className="text-[12px] text-white/40">Network</span>
              <span className="flex items-center gap-2 font-grotesk font-semibold text-[14px]">
                {selChain ? selChain.name : "Choose a chain"}
                <Icon name="chevronDown" size={15} className="text-white/50" />
              </span>
            </button>
            <button onClick={() => selChain && setTokenSheet(true)} disabled={!selChain} className="w-full flex items-center justify-between bg-surface border border-white/[.08] rounded-2xl px-4 h-[54px] mt-2.5 active:scale-[.99] disabled:opacity-40">
              <span className="text-[12px] text-white/40">Asset</span>
              <span className="flex items-center gap-2 font-grotesk font-semibold text-[14px]">
                {selToken ? selToken.symbol : "Choose an asset"}
                <Icon name="chevronDown" size={15} className="text-white/50" />
              </span>
            </button>

            <div className="bg-surface border border-white/[.08] rounded-2xl px-4 h-[52px] flex items-center gap-2 mt-2.5">
              <span className="text-white/40"><Icon name="scan" size={17} /></span>
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={selChain ? `${selChain.name} wallet address` : "Wallet address or scan QR"} className="flex-1 bg-transparent outline-none text-[14px]" />
              <button onClick={() => setScanOpen(true)} className="text-brand-cyan text-[13px] font-semibold">Scan</button>
            </div>
          </>
        )}

        {/* amount */}
        {(mode === "bank" || selToken) && (
          <div className="bg-surface border border-white/[.08] rounded-2xl px-4 py-4 mt-2.5 flex items-center justify-between">
            <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="Amount" className="bg-transparent outline-none text-[26px] font-grotesk font-bold w-full min-w-0" />
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-white/50 font-grotesk font-semibold">{activeSym}</span>
              <button onClick={() => setAmount(String(mode === "wallet" ? maxSendable : maxBankSend))} className="text-brand-cyan font-bold text-[13px]">Max</button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2 mt-4 px-1 text-[13px] text-white/55">
          {mode === "wallet" && selToken && (
            <>
              <div className="flex justify-between"><span>Network</span><b className="text-white font-grotesk">{selChain?.name}</b></div>
              <div className="flex justify-between"><span>Ttip fee</span><b className="text-white font-grotesk">${feeUsd.toFixed(2)}</b></div>
              <div className="flex justify-between">
                <span>Recipient gets</span>
                {previewing ? (
                  <b className="text-white/50 font-grotesk">checking…</b>
                ) : previewOut != null ? (
                  <b className="text-good font-grotesk">≈ {formatCrypto(previewOut, activeSym)} {activeSym}</b>
                ) : (
                  <b className="text-white/40 font-grotesk">enter address & amount</b>
                )}
              </div>
              {previewMsg && <div className="text-[12px] text-bad leading-snug mt-0.5">{previewMsg}</div>}
            </>
          )}
          {mode === "bank" && amt > 0 && (() => {
            const sending = convert(amt, sym, fiat);
            const fee = transferFee(sending, fiat);
            if (fee === null) {
              return (
                <div className="text-[12px] text-bad leading-snug">
                  Bank payouts in {fiat} aren&apos;t supported yet.
                </div>
              );
            }
            const total = sending + fee;
            return (
              <>
                {/* The amount typed is what ARRIVES. The fee is on top, out of
                    the remaining balance — like every bank in the country. */}
                <div className="flex justify-between"><span>They receive</span><b className="text-good font-grotesk">{formatFiat(sending, fiat)}</b></div>
                <div className="flex justify-between"><span>Transfer fee</span><b className="text-white font-grotesk">{formatFiat(fee, fiat)}</b></div>
                <div className="flex justify-between"><span>Total from your balance</span><b className="text-white font-grotesk">{formatFiat(total, fiat)}</b></div>
              </>
            );
          })()}
          {mode === "bank" ? (
            <>
              {/* Not "Balance" — the balance of one wallet was never the number
                  that decides a bank payout, and printing it as though it were
                  is what sent someone off to swap USDC to naira by hand. */}
              <div className="flex justify-between">
                <span>Available to send</span>
                <b className="text-white font-grotesk">{formatFiat(spendableTotal, fiat)}</b>
              </div>
              {spendableWallets.length > 1 && (
                <div className="text-[12px] text-white/40 leading-snug -mt-1">
                  Across {spendableWallets.map((w) => `${formatCrypto(w.amount, w.symbol)} ${w.symbol}`).join(" + ")}
                  {" — we convert as we send, so you never have to swap first."}
                </div>
              )}
              {splitFunding && (
                <div className="text-[12px] text-white/55 leading-snug">
                  This one comes from{" "}
                  <b className="text-white/80">
                    {fundingPlan!.legs.map((l) => `${formatCrypto(l.take, l.symbol)} ${l.symbol}`).join(" + ")}
                  </b>
                  .
                </div>
              )}
            </>
          ) : (
            selToken && (
              <div className="flex justify-between">
                <span>Balance</span>
                <b className="text-white font-grotesk">{`${formatCrypto(bal, activeSym)} ${activeSym}`}</b>
              </div>
            )
          )}
        </div>
      </div>

      <div className="pb-6 pt-2">
        {/*
          You cannot send what you do not hold.

          The token picker lists everything the withdrawal provider can deliver,
          which is far more than this account can ever hold — so it happily
          offered "2 PENGU" against a balance of 0, and quoted 287 PENGU back,
          because an asset we can't price got valued as if 2 of it were $2. A
          screen that invites a send it cannot make is worse than one that says
          no.
        */}
        <GradientButton
          onClick={submit}
          loading={loading}
          disabled={amt <= 0 || (mode === "wallet" && !selToken) || walletShort || bankShort}
        >
          {mode === "wallet"
            ? walletShort
              ? bal <= 0
                ? `No ${activeSym} to send`
                : "Insufficient balance"
              : "Send to wallet"
            : bankShort
              ? spendableTotal <= 0
                ? "Nothing to send yet"
                : `Short by ${formatFiat(fundingPlan?.short ?? 0, fiat)}`
              : "Send to bank"}
        </GradientButton>
      </div>

      <PinPrompt
        open={pinOpen}
        onClose={() => setPinOpen(false)}
        onPin={(pin) => send(pin)}
        error={pinError}
        busy={loading}
        subtitle={mode === "bank" ? `Sending ${formatFiat(convert(amt, sym, fiat), fiat)} to ${bank?.name ?? "your bank"}` : undefined}
      />

      <BankPicker open={bankOpen} onClose={() => setBankOpen(false)} onPick={(b) => setBank(b)} />
      <QrScanner open={scanOpen} onClose={() => setScanOpen(false)} onResult={(addr) => setAddress(addr)} />

      {/* Network picker */}
      <Sheet open={chainSheet} onClose={() => { setChainSheet(false); setChainQ(""); }} title="Choose a network">
        <input value={chainQ} onChange={(e) => setChainQ(e.target.value)} placeholder={`Search ${chains.length || "70+"} chains`} autoFocus className="w-full bg-surface border border-white/10 rounded-2xl px-4 h-[48px] outline-none text-[14px] focus:border-brand-cyan/50 mb-3" />
        <div className="flex flex-col gap-1 max-h-[55dvh] overflow-y-auto no-scrollbar">
          {sortChainsByPopularity(chains.filter((c) => c.name.toLowerCase().includes(chainQ.toLowerCase()))).map((c) => (
            <button key={c.chainId} onClick={() => pickChain(c)} className="flex items-center justify-between px-4 py-3.5 rounded-2xl bg-surface border border-white/[.06] active:scale-[.99]">
              <span className="font-grotesk font-semibold text-[14px]">{c.name}</span>
              {selChain?.chainId === c.chainId && <Icon name="check" size={16} className="text-good" strokeWidth={2.6} />}
            </button>
          ))}
          {chains.length === 0 && <div className="text-center text-white/40 text-[13px] py-6">Loading chains…</div>}
        </div>
      </Sheet>

      {/* Asset picker */}
      <Sheet open={tokenSheet} onClose={() => { setTokenSheet(false); setTokenQ(""); }} title={`Choose an asset${selChain ? ` on ${selChain.name}` : ""}`}>
        <input value={tokenQ} onChange={(e) => setTokenQ(e.target.value)} placeholder="Search assets" autoFocus className="w-full bg-surface border border-white/10 rounded-2xl px-4 h-[48px] outline-none text-[14px] focus:border-brand-cyan/50 mb-3" />
        <div className="flex flex-col gap-1 max-h-[55dvh] overflow-y-auto no-scrollbar">
          {tokens.filter((t) => t.symbol.toLowerCase().includes(tokenQ.toLowerCase()) || t.name.toLowerCase().includes(tokenQ.toLowerCase())).map((t) => (
            <button key={t.symbol} onClick={() => { setSelToken(t); setTokenSheet(false); setTokenQ(""); }} className="flex items-center justify-between px-4 py-3.5 rounded-2xl bg-surface border border-white/[.06] active:scale-[.99]">
              <span className="text-left">
                <span className="font-grotesk font-semibold text-[14px] block">{t.symbol}</span>
                <span className="text-[11.5px] text-white/40">{t.name}</span>
              </span>
              {selToken?.symbol === t.symbol && <Icon name="check" size={16} className="text-good" strokeWidth={2.6} />}
            </button>
          ))}
          {tokens.length === 0 && <div className="text-center text-white/40 text-[13px] py-6">No assets on this chain.</div>}
        </div>
      </Sheet>

      {receipt && (
        <Receipt
          reference={receipt.reference}
          onDone={() => { setReceipt(null); router.push("/home"); }}
          status={receipt.status === "pending" ? "pending" : "completed"}
          badge={receipt.kind === "wallet" ? "Crypto Withdrawal" : "Bank Transfer"}
          title={receipt.kind === "wallet" ? "Sent to wallet" : "Sent to bank"}
          amount={receipt.kind === "wallet"
            ? `${formatCrypto(receipt.amount, receipt.symbol)} ${receipt.symbol}`
            : formatFiat(receipt.fiatAmount, receipt.fiat)}
          fields={receipt.kind === "wallet"
            ? [
                { label: "Type", value: "Crypto withdrawal" },
                { label: "Sent by", value: state.user.name },
                { label: "Network", value: receipt.network },
                { label: "Wallet address", value: receipt.address, mono: true },
                { label: "Amount", value: `${formatCrypto(receipt.amount, receipt.symbol)} ${receipt.symbol}` },
                { label: "Network fee", value: `${formatCrypto(receipt.fee, receipt.symbol)} ${receipt.symbol}` },
                receipt.txHash ? { label: "Transaction hash", value: receipt.txHash, mono: true } : null,
              ]
            : [
                { label: "Type", value: "Bank Transfer" },
                { label: "Sent by", value: state.user.name },
                // The name the bank itself returned, so it matches the statement.
                { label: "Sent to", value: resolvedName || accountName || "—" },
                { label: "Receiver's account", value: bank ? `${bank.name} (${account})` : receipt.bank },
                { label: "Amount", value: formatFiat(receipt.fiatAmount, receipt.fiat) },
                receipt.narration ? { label: "Narration", value: receipt.narration } : null,
                receipt.fee ? { label: "Transfer fee", value: formatFiat(receipt.fee, receipt.fiat) } : null,
                { label: "Debited", value: `${formatCrypto(receipt.amount, receipt.symbol)} ${receipt.symbol}` },
              ]}
        />
      )}
    </div>
  );
}
