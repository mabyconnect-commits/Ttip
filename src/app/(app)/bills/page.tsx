"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { apiGet, apiPost } from "@/lib/client";
import { usePrices } from "@/lib/usePrices";
import { BackHeader, GradientButton, Sheet } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { BILL_CATEGORIES, BILL_FIAT } from "@/lib/constants";
import { pickFunding } from "@/lib/funding";
import { formatFiat, formatCrypto } from "@/lib/format";
import { billFee } from "@/lib/fees";
import { Receipt } from "@/components/Receipt";
import { PinPrompt } from "@/components/PinPrompt";

type Category = (typeof BILL_CATEGORIES)[number];

/**
 * Trim the noise off a plan name for the compact grid cards. The provider is
 * already selected above, so "MTN 1GB data purchase (7 days)" only needs to say
 * "1GB (7 days)" — the repeated network name and filler words just push the
 * useful part out of view.
 */
function planLabel(name: string): string {
  return (
    name
      .replace(/^(MTN|Airtel|Glo|9 ?mobile|Etisalat|DS?Tv|GOtv|Startimes|Showmax|Smile|Spectranet)\s*/i, "")
      .replace(/\b(data\s+)?(purchase|bundle|plan)\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim() || name
  );
}
interface Item { billerCode: string; itemCode: string; name: string; amount: number; variableAmount: boolean; label: string }
interface Provider { provider: string; items: Item[] }

export default function BillsPage() {
  const { state, action, toast } = useApp();
  const { convert } = usePrices();
  const router = useRouter();
  // Bills are priced by a naira catalog, so they're always shown and charged in
  // BILL_FIAT — not the user's display currency. Formatting a ₦100 plan with the
  // user's symbol would advertise "R100" for ₦100 of airtime.
  const fiat = BILL_FIAT;

  const [cat, setCat] = useState<Category | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [item, setItem] = useState<Item | null>(null); // chosen plan / variable sub-type
  const [account, setAccount] = useState("");
  const [amount, setAmount] = useState(0); // used only for variable-amount items
  const [loading, setLoading] = useState(false);
  const [receipt, setReceipt] = useState<any>(null);
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [planSheet, setPlanSheet] = useState(false);
  const [planQ, setPlanQ] = useState("");
  const [pinOpen, setPinOpen] = useState(false);
  const [pinError, setPinError] = useState(false);

  const funding = pickFunding(state.portfolio.assets);
  const fundBal = state.portfolio.assets.find((a) => a.symbol === funding)?.amount ?? 0;

  const variable = !!item?.variableAmount;
  const payAmount = item ? (variable ? amount : item.amount) : 0;
  const serviceFee = billFee(payAmount);
  const cost = convert(payAmount + serviceFee, fiat, funding);
  const needsValidation = !!item && /meter|smart/i.test(item.label);

  // Load providers + plans when a category opens.
  async function openCat(c: Category) {
    setCat(c); setProviders([]); setProvider(null); setItem(null); setAccount(""); setAmount(c.amounts[0] ?? 0); setResolvedName(null);
    setLoadingPlans(true);
    try {
      const r = await apiGet<{ providers: Provider[] }>(`/api/bills/plans?category=${c.id}`);
      setProviders(r.providers);
      if (r.providers[0]) pickProvider(r.providers[0], c);
    } catch (e: any) {
      toast(e.message || "Couldn't load plans", "bad");
    } finally {
      setLoadingPlans(false);
    }
  }

  function pickProvider(p: Provider, c: Category | null = cat) {
    setProvider(p);
    setResolvedName(null);
    // Auto-select the only variable item (e.g. airtime); otherwise wait for a pick.
    // When every item is variable (airtime, electricity prepaid/postpaid) there
    // is no plan to pick, so select the first straight away — otherwise the
    // screen sits empty with a dead Pay button until the user guesses to tap a
    // sub-type chip.
    const variableItems = p.items.filter((i) => i.variableAmount);
    if (variableItems.length > 0 && variableItems.length === p.items.length) {
      setItem(variableItems[0]);
      setAmount(c?.amounts[0] ?? 0);
    } else {
      setItem(null);
    }
  }

  // Resolve meter/smartcard holder name so the user can confirm before paying.
  useEffect(() => {
    setResolvedName(null);
    if (!item || !needsValidation || account.length < 5) return;
    let cancelled = false;
    setValidating(true);
    const t = setTimeout(async () => {
      try {
        const r = await apiPost<{ valid: boolean; name?: string }>("/api/validate-bill", { billerCode: item.billerCode, itemCode: item.itemCode, customer: account });
        if (!cancelled) setResolvedName(r.valid && r.name ? r.name : null);
      } catch {
        if (!cancelled) setResolvedName(null);
      } finally {
        if (!cancelled) setValidating(false);
      }
    }, 500);
    return () => { cancelled = true; clearTimeout(t); };
  }, [item, account, needsValidation]);

  /** Validate, then ask for the PIN. `send` does the actual purchase. */
  function pay() {
    if (!cat || !provider || !item) return toast("Choose a plan", "bad");
    if (!account) return toast(`Enter the ${item.label.toLowerCase()}`, "bad");
    if (payAmount <= 0) return toast("Choose an amount", "bad");
    if (cost > fundBal) return toast(`Not enough ${funding} to pay this bill`, "bad");
    setPinError(false);
    setPinOpen(true);
  }

  async function send(pin: string) {
    if (loading || !cat || !provider || !item) return;
    setLoading(true);
    try {
      const res: any = await action("/api/bills", {
        category: cat.id,
        provider: provider.provider,
        billerCode: item.billerCode,
        itemCode: item.itemCode,
        account,
        fiatAmount: variable ? amount : undefined,
        fundingSymbol: funding,
        pin,
      });
      setPinOpen(false);
      setReceipt(res.receipt);
    } catch (e: any) {
      if (/pin/i.test(e.message ?? "")) { setPinError(true); setPinOpen(true); }
      else setPinOpen(false);
      toast(e.message, "bad");
    } finally {
      setLoading(false);
    }
  }

  const variableItems = provider?.items.filter((i) => i.variableAmount) ?? [];
  const fixedItems = provider?.items.filter((i) => !i.variableAmount) ?? [];
  const presets = cat?.amounts ?? [];

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
          {loadingPlans ? (
            <div className="flex items-center gap-2 text-[13px] text-white/45 py-8 justify-center">
              <span className="w-4 h-4 rounded-full border-2 border-white/20 border-t-white/60 animate-spin" /> Loading plans…
            </div>
          ) : providers.length === 0 ? (
            <div className="text-center text-white/40 text-[13px] py-10">No plans available right now.</div>
          ) : (
            <>
              {/* provider */}
              <div className="text-[12px] text-white/50 mb-2">Provider</div>
              <div className="flex flex-wrap gap-2 pb-1">
                {providers.map((p) => (
                  <button key={p.provider} onClick={() => pickProvider(p)} className={`h-10 px-4 rounded-[20px] shrink-0 border font-grotesk font-semibold text-[13px] ${provider?.provider === p.provider ? "bg-white text-[#07080D] border-white" : "border-white/14 text-white/70"}`}>
                    {p.provider}
                  </button>
                ))}
              </div>

              {/* variable sub-type chips (e.g. Prepaid / Postpaid) */}
              {variableItems.length > 1 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {variableItems.map((it) => (
                    <button key={it.itemCode} onClick={() => setItem(it)} className={`h-9 px-4 rounded-[18px] shrink-0 border font-grotesk font-semibold text-[12.5px] ${item?.itemCode === it.itemCode ? "bg-brand-cyan/15 border-brand-cyan text-brand-cyan" : "border-white/12 text-white/65"}`}>
                      {it.name}
                    </button>
                  ))}
                </div>
              )}

              {/* fixed plans (data / tv / internet) — behind a dropdown. MTN
                  alone has 30+ bundles, so even a two-column grid ran for
                  screens and buried the phone-number field below it. */}
              {fixedItems.length > 0 && (
                <>
                  <div className="text-[12px] text-white/50 mt-4 mb-2">Plan</div>
                  <button
                    onClick={() => { setPlanSheet(true); setPlanQ(""); }}
                    className="w-full bg-surface border border-white/[.08] rounded-2xl px-4 h-[52px] flex items-center justify-between active:scale-[.99]"
                  >
                    <span className={`text-[13.5px] truncate pr-2 ${item ? "text-white" : "text-white/40"}`}>
                      {item ? planLabel(item.name) : `Choose a plan (${fixedItems.length})`}
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      {item && <b className="font-grotesk text-[13.5px]">{formatFiat(item.amount, fiat, { decimals: 0 })}</b>}
                      <Icon name="chevronDown" size={16} className="text-white/40" />
                    </span>
                  </button>
                </>
              )}

              {/* customer field */}
              {item && (
                <>
                  <input
                    value={account}
                    onChange={(e) => setAccount(e.target.value)}
                    placeholder={item.label}
                    inputMode={/number/i.test(item.label) ? "numeric" : "text"}
                    className="bg-surface border border-white/[.08] rounded-2xl px-4 h-[52px] outline-none text-[14px] focus:border-brand-cyan/50 mt-4"
                  />
                  {needsValidation && validating && (
                    <div className="mt-2 flex items-center gap-2 text-[13px] text-white/45 px-1">
                      <span className="w-3.5 h-3.5 rounded-full border-2 border-white/20 border-t-white/60 animate-spin" /> Checking…
                    </div>
                  )}
                  {needsValidation && !validating && resolvedName && (
                    <div className="mt-2 bg-good/[.08] border border-good/25 rounded-2xl px-4 h-[46px] flex items-center gap-2.5">
                      <Icon name="check" size={15} strokeWidth={2.6} className="text-good shrink-0" />
                      <span className="text-[13.5px] font-medium text-white truncate">{resolvedName}</span>
                    </div>
                  )}
                </>
              )}

              {/* amount (variable items only) */}
              {item && variable && (
                <>
                  <div className="text-[12px] text-white/50 mt-4 mb-2">Amount</div>
                  {presets.length > 0 && (
                    <div className="grid grid-cols-4 gap-2">
                      {presets.map((a) => (
                        <button key={a} onClick={() => setAmount(a)} className={`h-12 rounded-xl border font-grotesk font-semibold text-[13px] ${amount === a ? "bg-brand-cyan/15 border-brand-cyan text-brand-cyan" : "border-white/12 text-white/70"}`}>
                          {formatFiat(a, fiat, { decimals: 0 })}
                        </button>
                      ))}
                    </div>
                  )}
                  <input
                    value={amount || ""}
                    onChange={(e) => setAmount(parseFloat(e.target.value.replace(/[^0-9.]/g, "")) || 0)}
                    inputMode="decimal"
                    placeholder="Custom amount"
                    className="bg-surface border border-white/[.08] rounded-2xl px-4 h-[48px] outline-none text-[14px] focus:border-brand-cyan/50 mt-2 text-center font-grotesk"
                  />
                </>
              )}

              {item && payAmount > 0 && (
                <div className="flex flex-col gap-2 mt-4 px-1 text-[13px] text-white/55">
                  <div className="flex justify-between">
                    <span>{cat?.title ?? "Bill"}</span>
                    <b className="text-white font-grotesk">{formatFiat(payAmount, fiat, { decimals: 0 })}</b>
                  </div>
                  {serviceFee > 0 && (
                    <div className="flex justify-between">
                      <span>Service fee</span>
                      <b className="text-white font-grotesk">{formatFiat(serviceFee, fiat, { decimals: 0 })}</b>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>Pays from</span>
                    <b className="text-white font-grotesk">≈ {formatCrypto(cost, funding)} {funding}</b>
                  </div>
                </div>
              )}

              <div className="flex-1" />
              <div className="pb-6 pt-4">
                <GradientButton onClick={pay} loading={loading} disabled={!item || payAmount <= 0}>
                  {payAmount > 0 ? `Pay ${formatFiat(payAmount, fiat, { decimals: 0 })}` : "Pay"}
                </GradientButton>
              </div>
            </>
          )}
        </div>
      )}

      <Sheet open={planSheet} onClose={() => setPlanSheet(false)} title={`${provider?.provider ?? ""} plans`}>
        <input
          value={planQ}
          onChange={(e) => setPlanQ(e.target.value)}
          placeholder="Search plans…"
          className="w-full bg-surface2 border border-white/[.08] rounded-xl px-4 h-[46px] outline-none text-[14px] focus:border-brand-cyan/50 mb-3"
        />
        <div className="grid grid-cols-2 gap-2 max-h-[55vh] overflow-y-auto no-scrollbar">
          {fixedItems
            .filter((it) => it.name.toLowerCase().includes(planQ.toLowerCase().trim()))
            .map((it) => {
              const active = item?.itemCode === it.itemCode;
              return (
                <button
                  key={it.itemCode}
                  onClick={() => { setItem(it); setPlanSheet(false); }}
                  className={`rounded-2xl px-3 py-3 border text-left flex flex-col justify-between min-h-[76px] active:scale-[.98] ${
                    active ? "bg-brand-cyan/[.1] border-brand-cyan" : "bg-surface border-white/[.08]"
                  }`}
                >
                  <span className="text-[12.5px] font-medium text-white/85 leading-snug line-clamp-2">{planLabel(it.name)}</span>
                  <span className={`font-grotesk font-bold text-[14px] mt-1.5 ${active ? "text-brand-cyan" : "text-white"}`}>
                    {formatFiat(it.amount, fiat, { decimals: 0 })}
                  </span>
                </button>
              );
            })}
        </div>
      </Sheet>

      <PinPrompt
        open={pinOpen}
        onClose={() => setPinOpen(false)}
        onPin={(pin) => send(pin)}
        error={pinError}
        busy={loading}
        subtitle={item ? `${formatFiat(payAmount, fiat, { decimals: 0 })} · ${provider?.provider ?? ""} · ${account}` : undefined}
      />

      {receipt && (
        <Receipt
          onDone={() => { setReceipt(null); router.push("/home"); }}
          status={receipt.status === "pending" ? "pending" : "completed"}
          badge={receipt.category}
          title={receipt.status === "pending" ? `${receipt.category} processing` : `${receipt.category} paid`}
          amount={formatFiat(receipt.fiatAmount, BILL_FIAT)}
          reference={receipt.reference}
          fields={[
            { label: "Type", value: `${receipt.category} purchase` },
            { label: "Paid by", value: state.user.name },
            { label: "Provider", value: receipt.provider },
            receipt.plan ? { label: "Plan", value: receipt.plan } : null,
            { label: receipt.category === "Airtime" || receipt.category === "Data" ? "Phone number" : "Account / meter", value: receipt.account, mono: true },
            { label: "Amount", value: formatFiat(receipt.fiatAmount, BILL_FIAT) },
            receipt.serviceFee ? { label: "Service fee", value: formatFiat(receipt.serviceFee, BILL_FIAT) } : null,
            { label: "Debited", value: `${formatCrypto(receipt.cost, receipt.funding)} ${receipt.funding}` },
            resolvedName ? { label: "Account name", value: resolvedName } : null,
          ]}
        />
      )}
    </div>
  );
}
