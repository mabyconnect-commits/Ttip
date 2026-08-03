"use client";

import { useState } from "react";
import { COMPANY } from "@/lib/company";
import { buildReceiptImage } from "@/lib/receipt-image";

/**
 * Success screen for a completed money movement, with a shareable receipt.
 *
 * People who send money need proof to hand to whoever they sent it to, and
 * proof has to LOOK like proof. Sharing plain text landed in WhatsApp as an
 * ordinary message bubble — anyone could have typed it — so Share now sends a
 * branded PNG receipt with the Ttip logo, the amount, the details and the
 * reference. Text is kept as the fallback for anywhere files can't be shared.
 *
 * `reference` is what makes the receipt useful — it's the string support needs
 * to trace the payment — so it's shown and included whenever the caller has one.
 */
export function Receipt({
  title,
  lines,
  onDone,
  cta = "Tap anywhere to continue",
  reference,
  shareable = true,
}: {
  title: string;
  /** Optional — legacy callers may still pass an emoji; it is intentionally ignored. */
  emoji?: string;
  lines: (string | null | undefined | false)[];
  onDone: () => void;
  cta?: string;
  /** Provider/our reference, shown and included in the shared receipt. */
  reference?: string | null;
  /** Set false for flows where a receipt makes no sense (e.g. a deposit address). */
  shareable?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const detail = lines.filter(Boolean) as string[];
  const [primary, ...meta] = detail;

  /** Plain text so it reads correctly in WhatsApp, SMS or email. */
  function receiptText(): string {
    const when = new Date().toLocaleString("en-GB", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
    return [
      `${COMPANY.product} receipt`,
      "",
      title,
      ...detail,
      "",
      `Date: ${when}`,
      reference ? `Reference: ${reference}` : null,
      "",
      `Sent with ${COMPANY.product} · ${COMPANY.domain}`,
    ]
      .filter((l) => l !== null)
      .join("\n");
  }

  /** A filename the recipient can recognise in their downloads. */
  function fileName(): string {
    const stamp = new Date().toISOString().slice(0, 10);
    return `${COMPANY.product.toLowerCase()}-receipt-${stamp}.png`;
  }

  async function share() {
    if (sharing) return;
    setSharing(true);
    const text = receiptText();

    try {
      // 1. The real thing: a branded PNG through the native share sheet.
      const blob = await buildReceiptImage({
        title,
        primary,
        rows: meta,
        reference,
      }).catch(() => null);

      if (blob) {
        const file = new File([blob], fileName(), { type: "image/png" });
        if (navigator.canShare?.({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: `${COMPANY.product} receipt`, text });
            return;
          } catch (e: any) {
            // A dismissed sheet is not a failure — don't then dump a download.
            if (e?.name === "AbortError") return;
          }
        }

        // 2. Desktop / no file sharing: save the image instead.
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName();
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        return;
      }

      // 3. Canvas unavailable — the original text receipt still works.
      if (navigator.share) {
        try {
          await navigator.share({ title: `${COMPANY.product} receipt`, text });
          return;
        } catch {
          /* dismissed or unsupported — fall through to the clipboard */
        }
      }
      await navigator.clipboard?.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* nothing further we can do */
    } finally {
      setSharing(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col items-center bg-ink text-center"
      style={{
        background:
          "radial-gradient(90% 55% at 50% 34%, rgba(61,245,176,0.06), transparent 70%), #07080D",
      }}
      onClick={onDone}
    >
      <div className="flex-1 flex flex-col items-center justify-center px-10 w-full">
        {/* Success mark — a sharp checkmark, not an emoji orb */}
        <div className="animate-ringIn">
          <svg width="76" height="76" viewBox="0 0 76 76" fill="none" aria-hidden>
            <circle cx="38" cy="38" r="37" fill="rgba(61,245,176,0.05)" stroke="rgba(61,245,176,0.28)" strokeWidth="1.25" />
            <path
              d="M24 39.5 L34 49.5 L53 27.5"
              stroke="#3DF5B0"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="animate-draw"
              style={{ strokeDasharray: 48 }}
            />
          </svg>
        </div>

        <h2 className="mt-8 font-grotesk font-bold text-[38px] leading-none tracking-[-1px] text-white animate-rise">
          {title}
        </h2>

        {primary && (
          <p className="mt-3.5 font-sans text-[15px] text-white/70 animate-rise">{primary}</p>
        )}

        {reference && (
          <div className="mt-4 text-[11px] text-white/30 font-mono animate-rise break-all px-4">Ref {reference}</div>
        )}

        {meta.length > 0 && (
          <div className="mt-5 flex items-center gap-2.5 text-[12.5px] text-white/40 animate-rise">
            {meta.map((l, i) => (
              <span key={i} className="flex items-center gap-2.5">
                {i > 0 && <span className="w-[3px] h-[3px] rounded-full bg-white/25" />}
                {l}
              </span>
            ))}
          </div>
        )}
      </div>

      {shareable && (
        <div className="w-full px-8 pb-3 animate-rise" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={share}
            className="w-full h-[50px] rounded-2xl border border-white/15 text-white font-grotesk font-semibold text-[14px] flex items-center justify-center gap-2 active:scale-[.98]"
          >
            {sharing ? "Preparing receipt…" : copied ? "Receipt saved ✓" : "Share receipt"}
          </button>
        </div>
      )}

      <div className="pb-12 animate-rise">
        <span className="font-grotesk text-[11px] font-semibold tracking-[2px] uppercase text-white/35">
          {cta}
        </span>
      </div>
    </div>
  );
}
