"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { usePrices } from "@/lib/usePrices";
import { apiGet } from "@/lib/client";
import { pickFunding } from "@/lib/funding";
import { BackHeader, GradientButton, Sheet, Avatar } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { formatFiat, formatCrypto } from "@/lib/format";
import { Receipt } from "@/components/Receipt";
import { PinPrompt } from "@/components/PinPrompt";

interface Contact {
  name: string;
  handle: string;
  gradient: string;
  verified: boolean;
  initial: string;
  onPlatform: boolean;
}

const EMOJIS = ["🎂", "🙏", "🔥", "💐", "🍾", "😂", "❤️", "🍢"];

export default function TtipPage() {
  const { state, action, toast } = useApp();
  const { convert } = usePrices();
  const router = useRouter();
  const searchParams = useSearchParams();
  const toParam = searchParams.get("to");
  const fiat = state.user.defaultFiat;
  const chips = fiat === "NGN" ? [5000, 10000, 25000, 50000] : [50, 100, 250, 500];

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState("");
  const [recipient, setRecipient] = useState<Contact | null>(null);
  const [amount, setAmount] = useState(fiat === "NGN" ? 25000 : 250);
  const [note, setNote] = useState("");
  const [emoji, setEmoji] = useState("⚡");
  const [pickOpen, setPickOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinError, setPinError] = useState(false);
  const [receipt, setReceipt] = useState<any>(null);

  const funding = pickFunding(state.portfolio.assets);
  const cost = convert(amount, fiat, funding);
  const fundBal = state.portfolio.assets.find((a) => a.symbol === funding)?.amount ?? 0;

  useEffect(() => {
    apiGet<{ contacts: Contact[] }>("/api/contacts?q=" + encodeURIComponent(query))
      .then((d) => {
        setContacts(d.contacts);
        // Only preselect when the link explicitly targets someone (?to=handle).
        // Never auto-pick a contact — the user chooses who to Ttip, so the page
        // opens on "Choose someone" instead of a random (often demo) recipient.
        if (!recipient && query === "" && toParam) {
          const preset = d.contacts.find((c) => c.handle.replace(/^@/, "").toLowerCase() === toParam.toLowerCase());
          if (preset) setRecipient(preset);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  /** Checks the tip is sendable, then opens the PIN pad. Nothing moves yet. */
  function review() {
    if (!recipient) return toast("Choose someone to Ttip", "bad");
    if (amount <= 0) return toast("Enter an amount", "bad");
    if (cost > fundBal) return toast(`Not enough ${funding} to cover this tip`, "bad");
    setPinError(false);
    setPinOpen(true);
  }

  async function send(pin: string) {
    if (!recipient) return;
    setLoading(true);
    try {
      const res: any = await action("/api/send", {
        mode: "ttip",
        recipient: recipient.handle,
        fiat,
        fiatAmount: amount,
        fundingSymbol: funding,
        note: note || undefined,
        emoji,
        pin,
      });
      setPinOpen(false);
      setReceipt(res.receipt);
    } catch (e: any) {
      // A rejected PIN re-arms the pad; anything else is a real failure and
      // closing it is the honest response.
      if (/pin/i.test(e?.message ?? "")) {
        setPinError(true);
      } else {
        setPinOpen(false);
      }
      toast(e.message, "bad");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col flex-1 px-[22px] min-h-0">
      {/* A tip is irreversible once it lands, so it asks for the PIN a bank
          payout does. Someone with no PIN yet is sent to Security to set one. */}
      <PinPrompt
        open={pinOpen}
        onClose={() => setPinOpen(false)}
        onPin={send}
        error={pinError}
        busy={loading}
        title="Confirm this Ttip"
        subtitle={recipient ? `${formatFiat(amount, fiat)} to ${recipient.name}` : undefined}
      />
      <BackHeader title="Ttip" right={<button onClick={() => setPickOpen(true)} className="w-9 h-9 rounded-full border border-white/10 flex items-center justify-center text-white/70"><Icon name="grid" size={16} /></button>} />

      <div className="flex-1 overflow-y-auto no-scrollbar">
        {/* recipient */}
        <button onClick={() => setPickOpen(true)} className="w-full flex flex-col items-center gap-2 pt-2.5 pb-1">
          {recipient ? (
            <>
              <Avatar gradient={recipient.gradient} initial={recipient.initial} size={72} ring />
              <div className="font-grotesk font-semibold text-[16px]">
                {recipient.name} {recipient.verified && <span className="text-brand-cyan text-[13px]">✓</span>}
              </div>
              <div className="font-sans text-[12px] text-white/45">{recipient.handle} · tap to change</div>
            </>
          ) : (
            <>
              <div className="w-[72px] h-[72px] rounded-full border-2 border-dashed border-white/20 flex items-center justify-center text-2xl text-white/40">+</div>
              <div className="font-grotesk font-semibold text-[15px]">Choose someone</div>
            </>
          )}
        </button>

        {/* amount */}
        <div className="text-center pt-4 pb-1.5">
          <div className="font-grotesk font-bold text-[52px] leading-none tracking-[-2px]">{formatFiat(amount, fiat, { decimals: 0 })}</div>
          <div className="font-sans text-[13px] text-white/45 mt-2">
            paid from {funding} · ≈ {formatCrypto(cost, funding)} {funding}
            {recipient && !recipient.onPlatform ? " · they'll be invited to claim" : ""}
          </div>
        </div>

        <div className="flex justify-center gap-2 py-3.5">
          {chips.map((c) => (
            <button
              key={c}
              onClick={() => setAmount(c)}
              className={`font-grotesk font-semibold text-[12px] rounded-full px-3.5 py-1.5 transition ${amount === c ? "bg-good text-ink" : "border border-white/12 text-white/70"}`}
            >
              {formatFiat(c, fiat, { decimals: 0 })}
            </button>
          ))}
        </div>

        {/* custom amount */}
        <input
          value={amount || ""}
          onChange={(e) => setAmount(parseFloat(e.target.value.replace(/[^0-9.]/g, "")) || 0)}
          inputMode="decimal"
          placeholder="Custom amount"
          className="w-full text-center bg-surface border border-white/[.08] rounded-2xl h-11 mb-3 outline-none focus:border-brand-cyan/50 text-[15px] font-grotesk"
        />

        {/* note */}
        <div className="bg-surface border border-white/[.08] rounded-2xl px-4 py-3.5">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note — what's it for?"
            maxLength={140}
            className="w-full bg-transparent outline-none font-sans text-[14px]"
          />
        </div>
        <div className="flex gap-2.5 py-3 px-0.5 text-xl flex-wrap">
          {EMOJIS.map((e) => (
            <button key={e} onClick={() => { setEmoji(e); setNote((n) => (n.endsWith(e) ? n : n + " " + e).trim()); }} className={`transition ${emoji === e ? "scale-125" : "opacity-60"}`}>
              {e}
            </button>
          ))}
        </div>
      </div>

      <div className="pb-6 pt-1">
        <GradientButton onClick={review} loading={loading} disabled={!recipient || amount <= 0}>
          Ttip {formatFiat(amount, fiat, { decimals: 0 })}
        </GradientButton>
      </div>

      <Sheet open={pickOpen} onClose={() => setPickOpen(false)} title="Ttip someone">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search @username or name"
          className="w-full h-12 rounded-2xl bg-surface border border-white/10 px-4 mb-3 outline-none focus:border-brand-cyan/50 text-[14px]"
          autoFocus
        />
        <div className="flex flex-col gap-1.5">
          {contacts.map((c) => (
            <button key={c.handle} onClick={() => { setRecipient(c); setPickOpen(false); }} className="flex items-center gap-3 bg-surface border border-white/[.06] rounded-2xl px-3.5 py-3 active:scale-[.99]">
              <Avatar gradient={c.gradient} initial={c.initial} size={38} />
              <div className="flex-1 text-left">
                <div className="font-semibold text-[14px]">
                  {c.name} {c.verified && <span className="text-brand-cyan text-xs">✓</span>}
                </div>
                <div className="text-[12px] text-white/40">{c.handle}{c.onPlatform ? "" : " · off-app"}</div>
              </div>
            </button>
          ))}
          {contacts.length === 0 && <div className="text-center text-white/40 text-[13px] py-6">No matches. They can still be tipped by @handle.</div>}
        </div>
      </Sheet>

      {receipt && (
        <Receipt
          reference={receipt.reference}
          onDone={() => { setReceipt(null); router.push("/feed"); }}
          badge="Ttip"
          title="Ttip sent"
          amount={formatFiat(receipt.fiatAmount, receipt.fiat, { decimals: 0 })}
          fields={[
            { label: "Type", value: "Ttip transfer" },
            { label: "Sent by", value: state.user.name },
            { label: receipt.delivered ? "Sent to" : "Invite sent to", value: receipt.recipient },
            { label: "Amount", value: formatFiat(receipt.fiatAmount, receipt.fiat, { decimals: 0 }) },
            { label: "Debited", value: `${formatCrypto(receipt.cost, receipt.funding)} ${receipt.funding}` },
            receipt.note ? { label: "Note", value: receipt.note } : null,
            ...(receipt.delivered ? [] : [{ label: "Status note", value: "Held until they join Ttip with this handle." }]),
          ]}
        />
      )}
    </div>
  );
}
