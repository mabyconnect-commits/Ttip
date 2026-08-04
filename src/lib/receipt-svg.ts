import "server-only";
import { COMPANY } from "./company";
import { ensureReceiptFont, receiptLogo, RECEIPT_FONT } from "./receipt-fonts";

/**
 * A receipt drawn on the SERVER, as a real image.
 *
 * The app's receipt is drawn on a canvas, which only exists in a browser. A
 * Telegram transfer never touches one — the whole point is that it happens in a
 * chat — so a receipt for it has to be built here.
 *
 * SVG, converted to PNG by sharp. A receipt is text on a card: no photographs,
 * no gradients that matter, nothing an SVG can't say. That keeps the layout
 * readable and diffable instead of a wall of canvas draw calls, and it renders
 * identically every time.
 *
 * Shape follows what a receipt is FOR: the amount is the headline, then who was
 * paid, then every detail spelled out as a labelled row. Whoever receives this
 * should be able to reconcile it against a bank statement without asking a
 * single question.
 */

export interface ReceiptRow {
  label: string;
  value: string;
}

/** Nothing may run off the card, however long the bank returned it. */
const MAX_VALUE_CHARS = 46;
const clamp = (v: string) =>
  v.length > MAX_VALUE_CHARS ? v.slice(0, MAX_VALUE_CHARS - 1).trimEnd() + "…" : v;

export interface ServerReceipt {
  /** Headline, already formatted: "₦5,000.00". */
  amount: string;
  /** Shown under the amount: "Bank Transfer". */
  kind: string;
  /** "Completed" | "Pending" | "Failed". */
  status: string;
  rows: ReceiptRow[];
  /** Printed small at the bottom. */
  reference: string;
}

const W = 720;
const PAD = 44;
const ROW_H = 52;
/** Past this, a value can't share a line with its label without colliding. */
const LONG_VALUE = 26;
const TALL_ROW_H = 76;

const BG = "#0B0D14";
const CARD = "#12141D";
const FG = "#FFFFFF";
const MUTED = "#8C93A6";
const GOOD = "#3DF5B0";
const WARN = "#FFC85B";
const BAD = "#FF7A8A";

/** SVG has five characters that must never appear raw in text content. */
function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function statusColour(status: string): string {
  const s = status.toLowerCase();
  if (s.startsWith("complete") || s === "sent" || s === "success") return GOOD;
  if (s.startsWith("fail")) return BAD;
  return WARN;
}

const FONT = `${RECEIPT_FONT}, DejaVu Sans, sans-serif`;

export function receiptSvg(r: ServerReceipt, logo?: string | null): string {
  const rows = r.rows.filter((x) => x.value).map((x) => ({ ...x, value: clamp(x.value) }));
  const heights = rows.map((row) => (row.value.length > LONG_VALUE ? TALL_ROW_H : ROW_H));
  const cardTop = 182;
  const cardH = 40 + heights.reduce((a, b) => a + b, 0);
  const H = cardTop + cardH + 132;

  // A long value — an account name like "JENMEC SOLUTIONS LTD - MATTHEW
  // OLUWATOBI ADELEYE" — cannot share a line with its label without running
  // straight through it. Those get their own line underneath instead.
  let cursor = cardTop + 46;
  const rowSvg = rows
    .map((row, i) => {
      const tall = heights[i] === TALL_ROW_H;
      const y = cursor;
      cursor += heights[i];
      const body = tall
        ? `<text x="${PAD + 26}" y="${y}" font-family="${FONT}" font-size="16" fill="${MUTED}">${esc(row.label)}</text>` +
          `<text x="${PAD + 26}" y="${y + 26}" font-family="${FONT}" font-size="18" font-weight="600" fill="${FG}">${esc(
            row.value,
          )}</text>`
        : `<text x="${PAD + 26}" y="${y}" font-family="${FONT}" font-size="17" fill="${MUTED}">${esc(row.label)}</text>` +
          `<text x="${W - PAD - 26}" y="${y}" font-family="${FONT}" font-size="18" font-weight="600" fill="${FG}" text-anchor="end">${esc(
            row.value,
          )}</text>`;
      const rule =
        i < rows.length - 1
          ? `<rect x="${PAD + 26}" y="${y + (tall ? 42 : 17)}" width="${W - PAD * 2 - 52}" height="1" fill="#FFFFFF" opacity="0.06"/>`
          : "";
      return body + rule;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>

  ${logo ? `<image x="${PAD}" y="30" width="40" height="40" href="${logo}" preserveAspectRatio="xMidYMid meet"/>` : ""}
  <text x="${logo ? PAD + 54 : PAD}" y="58" font-family="${FONT}" font-size="22" font-weight="700" fill="${FG}">${esc(COMPANY.product)}</text>
  <text x="${W - PAD}" y="58" font-family="${FONT}" font-size="17" fill="${statusColour(
    r.status,
  )}" text-anchor="end">${esc(r.status)}</text>

  <text x="${PAD}" y="140" font-family="${FONT}" font-size="52" font-weight="700" fill="${FG}">${esc(r.amount)}</text>
  <text x="${PAD}" y="170" font-family="${FONT}" font-size="17" fill="${MUTED}">${esc(r.kind)}</text>

  <rect x="${PAD}" y="${cardTop}" width="${W - PAD * 2}" height="${cardH}" rx="22" fill="${CARD}"/>
  ${rowSvg}

  <text x="${PAD}" y="${cardTop + cardH + 52}" font-family="${FONT}" font-size="14" fill="${MUTED}">Reference</text>
  <text x="${PAD}" y="${cardTop + cardH + 76}" font-family="${FONT}" font-size="16" fill="${FG}">${esc(r.reference)}</text>
  <text x="${W - PAD}" y="${cardTop + cardH + 76}" font-family="${FONT}" font-size="14" fill="${MUTED}" text-anchor="end">${esc(
    COMPANY.domain,
  )}</text>
</svg>`;
}

/**
 * Render the receipt to a PNG.
 *
 * Returns null rather than throwing: a receipt is a nicety, and a transfer that
 * already succeeded must never be reported as failed because a picture of it
 * couldn't be drawn.
 */
export async function renderReceiptPng(r: ServerReceipt): Promise<Buffer | null> {
  try {
    // No bundled font means no readable image — boxes are worse than no
    // receipt, because the user forwards them believing they say something.
    if (!ensureReceiptFont()) return null;
    // A missing logo is cosmetic — the receipt still goes out without it.
    const logo = await receiptLogo();
    const sharp = (await import("sharp")).default;
    return await sharp(Buffer.from(receiptSvg(r, logo))).png().toBuffer();
  } catch (e) {
    console.error("[receipt] could not render", e);
    return null;
  }
}
