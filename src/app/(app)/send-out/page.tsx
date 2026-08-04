"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { apiGet, apiPost } from "@/lib/client";
import { usePrices } from "@/lib/usePrices";
import { BackHeader, Segmented, GradientButton, Sheet } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { WITHDRAW_FEE_USDT } from "@/lib/constants";
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
  const { convert } = usePrices();
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

  const symIsFiat = sym === fiat;

  // Preview of which wallets will pay, using the same planner the server runs.
  // Purely informational — the server plans again from real balances.
  const fundingPlan = (() => {
    if (mode !== "bank" || amt <= 0 || !sym) return null;
    const sources = state.portfolio.assets
      .filter((a) => a.amount > 0)
      .map((a) => ({ symbol: a.symbol, amount: a.amount, fiatPerUnit: convert(1, a.symbol, fiat) }))
      .filter((a) => a.fiatPerUnit > 0);
    return planFunding(convert(amt, sym, fiat), sources, sym);
  })();
  // Only worth showing when more than one wallet is involved.
  const splitFunding = !!fundingPlan?.ok && (fundingPlan?.legs.length ?? 0) > 1;

  // The active asset + destination differ by mode.
  const walletSym = selToken?.symbol ?? "";
  const activeSym = mode === "wallet" ? walletSym : sym;
  const bal = state.portfolio.assets.find((a) => a.symbol === activeSym)?.amount ?? 0;
  const feeInAsset = activeSym ? convert(WITHDRAW_FEE_USDT, "USDT", activeSym) : 0;
  const maxSendable = Math.max(0, bal - feeInAsset); // Max must leave room for the fee

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
    setPinOpen(true);
  }

  async function send(pin: string) {
    setLoading(true);
    try {
      let body: any;
      if (mode === "wallet") {
        if (amt + feeInAsset > bal + 1e-12) { setLoading(false); return toast(`Not enough ${walletSym} to cover amount + fee`, "bad"); }
        body = { mode: "wallet", symbol: walletSym, amount: amt, address, network: selChain!.name, chainId: selChain!.chainId, pin };
      } else {
        body = { mode: "bank", symbol: sym, amount: amt, fiat, bankName: bank!.name, accountNumber: account, accountName: resolvedName ?? accountName, note: cleanNarration(note) || undefined, pin };
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
              <button onClick={() => setAmount(String(mode === "wallet" ? maxSendable : bal))} className="text-brand-cyan font-bold text-[13px]">Max</button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2 mt-4 px-1 text-[13px] text-white/55">
          {mode === "wallet" && selToken && (
            <>
              <div className="flex justify-between"><span>Network</span><b className="text-white font-grotesk">{selChain?.name}</b></div>
              <div className="flex justify-between"><span>Ttip fee</span><b className="text-white font-grotesk">${WITHDRAW_FEE_USDT.toFixed(2)}</b></div>
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
            const gross = convert(amt, sym, fiat);
            const fee = transferFee(gross, fiat);
            if (fee === null) {
              return (
                <div className="text-[12px] text-bad leading-snug">
                  Bank payouts in {fiat} aren&apos;t supported yet.
                </div>
              );
            }
            const net = Math.max(0, gross - fee);
            return (
              <>
                <div className="flex justify-between"><span>Transfer fee</span><b className="text-white font-grotesk">{formatFiat(fee, fiat)}</b></div>
                <div className="flex justify-between"><span>You receive</span><b className="text-good font-grotesk">≈ {formatFiat(net, fiat)}</b></div>
              </>
            );
          })()}
          {(mode === "bank" || selToken) && (
            <div className="flex justify-between">
              <span>Balance</span>
              <b className="text-white font-grotesk">
                {/* Naira is a currency, not a token — don't print it to 6 decimals. */}
                {symIsFiat && mode === "bank" ? formatFiat(bal, fiat) : `${formatCrypto(bal, activeSym)} ${activeSym}`}
              </b>
            </div>
          )}
        </div>
      </div>

      <div className="pb-6 pt-2">
        <GradientButton onClick={submit} loading={loading} disabled={amt <= 0 || (mode === "wallet" && !selToken)}>
          {mode === "bank" ? "Send to bank" : "Send to wallet"}
        </GradientButton>
      </div>

      <PinPrompt
        open={pinOpen}
        onClose={() => setPinOpen(false)}
        onPin={(pin) => send(pin)}
        error={pinError}
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
