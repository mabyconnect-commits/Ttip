"use client";

import { useEffect, useState } from "react";
import { COMPANY } from "@/lib/company";
import { buildReceiptImage, type ReceiptField } from "@/lib/receipt-image";
import { buildReceiptPdf } from "@/lib/receipt-pdf";

/**
 * Success screen for a completed money movement — and the receipt itself.
 *
 * A receipt has one job: be proof. So the AMOUNT leads, big and bold, and every
 * detail is spelled out as a labelled row — type, who sent it, who received it,
 * the destination account, the fee, the narration, the reference. Whoever
 * receives it should be able to reconcile it against a bank statement without
 * asking a single question.
 *
 * What's on screen and what gets shared are the same receipt, drawn from the
 * same data. Share sends a branded PNG or a PDF; sharing plain text landed in
 * WhatsApp as an ordinary message bubble that anyone could have typed, which is
 * the opposite of proof. Text survives only as the last-resort fallback.
 */
export function Receipt({
  title,
  amount,
  badge,
  status,
  fields,
  lines,
  onDone,
  cta = "Tap anywhere to continue",
  reference,
  shareable = true,
}: {
  /** Short headline, e.g. "Sent" or "Airtime paid". */
  title: string;
  /** The money, already formatted — this is what leads the receipt. */
  amount?: string;
  /** Category badge, e.g. "Bank Transfer". Defaults to the product name. */
  badge?: string;
  /** Drives the status pill; "pending" means the money is still moving. */
  status?: "completed" | "pending";
  /** The detail rows. Preferred over `lines`. */
  fields?: (ReceiptField | null | undefined | false)[];
  /** Optional — legacy callers may still pass an emoji; it is intentionally ignored. */
  emoji?: string;
  /** Legacy free-form detail lines, rendered without labels. */
  lines?: (string | null | undefined | false)[];
  onDone: () => void;
  cta?: string;
  /** Provider/our reference — the string support needs to trace the payment. */
  reference?: string | null;
  /** Set false for flows where a receipt makes no sense (e.g. a deposit address). */
  shareable?: boolean;
}) {
  const [busy, setBusy] = useState<"" | "image" | "pdf">("");
  const [saved, setSaved] = useState(false);

  const legacy = (lines ?? []).filter(Boolean) as string[];
  const given = (fields ?? []).filter(Boolean) as ReceiptField[];

  // Without explicit fields, fall back to the old free-form lines: the first is
  // the headline if no amount was given, the rest become label-less rows.
  const hero = amount ?? (given.length ? undefined : legacy[0]) ?? title;
  const rows: ReceiptField[] = given.length
    ? given
    : legacy.slice(amount ? 0 : 1).map((l) => ({ label: "", value: l }));

  const when = new Date();
  const stamp = `${when.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "short", year: "numeric" })} · ${when
    .toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true })
    .toUpperCase()}`;

  /**
   * The status, kept live while the receipt is on screen.
   *
   * A live bank payout is accepted as "pending" and confirmed a moment later,
   * so this used to be a snapshot of the worst instant: "Processing", for ever,
   * long after the money had landed — and permanently so if the provider's
   * webhook never arrived. While it says Processing, the receipt asks; the
   * endpoint also re-queries the provider, so a missing webhook stops being the
   * end of the story.
   */
  const [live, setLive] = useState<"completed" | "pending" | "failed" | null>(null);
  const settled = live ?? status ?? "completed";
  const pending = settled === "pending";
  const failed = settled === "failed";
  const statusLabel = failed ? "Not sent" : pending ? "Processing" : "Successful";

  useEffect(() => {
    if (!reference || (status ?? "completed") !== "pending" || live) return;
    let alive = true;
    let tries = 0;
    // Every few seconds for about two minutes. Beyond that it isn't "settling
    // in a moment" any more, and the transaction list is the place to look.
    const timer = setInterval(async () => {
      tries += 1;
      if (tries > 40 || !alive) return clearInterval(timer);
      try {
        const r = await fetch(`/api/transactions/status?reference=${encodeURIComponent(reference)}`);
        const j = await r.json().catch(() => null);
        const s = j?.status;
        if (alive && (s === "completed" || s === "failed")) {
          setLive(s);
          clearInterval(timer);
        }
      } catch {
        /* offline, or the tab is asleep — try again on the next tick */
      }
    }, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [reference, status, live]);

  /** Every row that goes into the shared file, including date and reference. */
  const shareFields: ReceiptField[] = [
    ...rows,
    { label: "Date", value: stamp },
    ...(reference ? [{ label: "Reference", value: reference, mono: true }] : []),
  ];

  const payload = {
    amount: hero,
    badge: badge ?? COMPANY.product,
    status: { label: statusLabel, tone: pending || failed ? ("pending" as const) : ("good" as const) },
    fields: shareFields,
    date: when,
  };

  /** Plain text, kept for the case where no file can be produced at all. */
  function receiptText(): string {
    return [
      `${COMPANY.product} receipt`,
      "",
      hero,
      title,
      "",
      ...shareFields.map((f) => (f.label ? `${f.label}: ${f.value}` : f.value)),
      "",
      `Sent with ${COMPANY.product} · ${COMPANY.domain}`,
    ].join("\n");
  }

  function fileName(ext: string): string {
    return `${COMPANY.product.toLowerCase()}-receipt-${when.toISOString().slice(0, 10)}.${ext}`;
  }

  function download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
  }

  async function share(kind: "image" | "pdf") {
    if (busy) return;
    setBusy(kind);
    try {
      const blob = await (kind === "pdf" ? buildReceiptPdf(payload) : buildReceiptImage(payload)).catch(
        () => null,
      );

      if (blob) {
        const name = fileName(kind === "pdf" ? "pdf" : "png");
        const file = new File([blob], name, { type: blob.type });
        if (navigator.canShare?.({ files: [file] })) {
          try {
            // FILES ONLY — no `text` or `title`. Given both, WhatsApp sends the
            // text and silently drops the attachment, which is exactly how the
            // "shareable receipt" kept arriving as a plain green message.
            await navigator.share({ files: [file] });
            return;
          } catch (e: any) {
            // A dismissed sheet isn't a failure — don't then dump a download.
            if (e?.name === "AbortError") return;
          }
        }
        download(blob, name);
        return;
      }

      // Canvas unavailable — the text receipt still gets the numbers across.
      const text = receiptText();
      if (navigator.share) {
        try {
          await navigator.share({ title: `${COMPANY.product} receipt`, text });
          return;
        } catch {
          /* dismissed or unsupported — fall through to the clipboard */
        }
      }
      await navigator.clipboard?.writeText(text);
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    } catch {
      /* nothing further we can do */
    } finally {
      setBusy("");
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-ink"
      style={{
        background: "radial-gradient(85% 45% at 50% 22%, rgba(61,245,176,0.07), transparent 70%), #07080D",
      }}
      onClick={onDone}
    >
      <div className="flex-1 overflow-y-auto no-scrollbar px-5 pt-6 pb-2" onClick={(e) => e.stopPropagation()}>
        {/* header: brand left, category right */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/ttip-logo.png" alt="" width={30} height={30} className="rounded-lg" />
            <span className="font-grotesk font-bold text-[17px]">{COMPANY.product}</span>
          </div>
          <span className="text-[11.5px] text-white/60 border border-white/10 bg-white/[.04] rounded-full px-3 py-1.5">
            {badge ?? title}
          </span>
        </div>

        {/* hero: the money */}
        <div className="text-center mt-9">
          <div className="font-grotesk font-bold text-[42px] leading-none tracking-[-1.5px] text-white break-words">
            {hero}
          </div>
          <div className="text-white/45 text-[12.5px] mt-3">{stamp}</div>
          <div
            className="inline-flex items-center gap-2 mt-4 rounded-full px-3.5 py-1.5 text-[12px] font-medium"
            style={{
              background: failed ? "rgba(255,122,138,.12)" : pending ? "rgba(255,196,107,.12)" : "rgba(61,245,176,.12)",
              color: failed ? "#FF7A8A" : pending ? "#FFC46B" : "#3DF5B0",
            }}
          >
            <span className="w-[6px] h-[6px] rounded-full" style={{ background: "currentColor" }} />
            {statusLabel}
          </div>
        </div>

        {/* the details */}
        <div className="mt-7 rounded-3xl bg-surface border border-white/[.06] px-5">
          {rows.map((f, i) => (
            <div
              key={i}
              className={i > 0 ? "py-4 border-t border-dashed border-white/[.10]" : "py-4"}
            >
              {f.label && <div className="text-white/40 text-[11.5px]">{f.label}</div>}
              <div
                className={`text-white/95 text-[14px] font-medium break-words ${f.label ? "mt-1.5" : ""} ${
                  f.mono ? "font-mono text-[12.5px]" : ""
                }`}
              >
                {f.value}
              </div>
            </div>
          ))}
          <div className="py-4 border-t border-dashed border-white/[.10]">
            <div className="text-white/40 text-[11.5px]">Date</div>
            <div className="text-white/95 text-[14px] font-medium mt-1.5">{stamp}</div>
          </div>
          {reference && (
            <div className="py-4 border-t border-dashed border-white/[.10]">
              <div className="text-white/40 text-[11.5px]">Reference</div>
              <div className="text-white/80 text-[12px] font-mono mt-1.5 break-all">{reference}</div>
            </div>
          )}
        </div>

        <div className="text-center text-white/30 text-[11px] mt-5">
          Sent with {COMPANY.product} · {COMPANY.domain}
        </div>
      </div>

      {shareable && (
        <div className="px-5 pt-2 grid grid-cols-2 gap-2.5" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => share("image")}
            disabled={!!busy}
            className="h-[50px] rounded-2xl bg-good text-ink font-grotesk font-semibold text-[13.5px] active:scale-[.98] disabled:opacity-60"
          >
            {busy === "image" ? "Preparing…" : "Share as image"}
          </button>
          <button
            onClick={() => share("pdf")}
            disabled={!!busy}
            className="h-[50px] rounded-2xl border border-white/15 text-white font-grotesk font-semibold text-[13.5px] active:scale-[.98] disabled:opacity-60"
          >
            {busy === "pdf" ? "Preparing…" : "Share as PDF"}
          </button>
        </div>
      )}

      <div className="text-center pb-8 pt-4">
        <span className="font-grotesk text-[11px] font-semibold tracking-[2px] uppercase text-white/35">
          {saved ? "Receipt saved ✓" : cta}
        </span>
      </div>
    </div>
  );
}
