import { COMPANY } from "./company";

/**
 * Draw a Ttip receipt as a PNG the user can send to whoever they paid.
 *
 * Shape follows what a receipt is actually for: the AMOUNT is the headline, big
 * and bold, then the date, then every detail spelled out as a labelled row —
 * type, who sent it, who received it, the destination account, the fee, the
 * narration, the reference. Someone receiving this should be able to reconcile
 * it against their bank statement without asking a single question.
 *
 * Canvas rather than a screenshot library so there's no new dependency and no
 * dependence on what's currently on screen — the image is drawn from the same
 * data the success screen was given.
 *
 * Browser-only: it touches document/canvas, so call it from a client component.
 */

export interface ReceiptField {
  /** Empty renders the value on its own — used by the legacy line-based callers. */
  label: string;
  value: string;
  /** Monospace + hard wrapping, for references and account numbers. */
  mono?: boolean;
}

export interface ReceiptImageInput {
  /** The headline, already formatted, e.g. "₦5,000.00". */
  amount: string;
  /** Category shown top-right, e.g. "Bank Transfer". */
  badge?: string;
  /** Green when the money has landed, amber while it's still moving. */
  status?: { label: string; tone: "good" | "pending" };
  fields: ReceiptField[];
  date?: Date;
}

const W = 1080;
const PAD = 56;
const GREEN = "#3DF5B0";
const CYAN = "#2AC8FF";
const AMBER = "#FFC46B";
const BG = "#08090F";
const CARD = "#12151D";

/** The app's own font stack, so the receipt matches the product. */
function fontStack(): string {
  try {
    const f = getComputedStyle(document.body).fontFamily;
    if (f) return f;
  } catch {}
  return 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
}

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

function loadLogo(): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // no logo is better than no receipt
    img.src = "/ttip-logo.png";
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Split on spaces to fit `maxWidth` at the ctx's current font. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth || !line) {
      line = next;
      continue;
    }
    out.push(line);
    line = word;
  }
  if (line) out.push(line);
  return out;
}

/** Break an unspaced string (a reference) on width rather than on spaces. */
function wrapHard(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxWidth && line) {
      out.push(line);
      line = ch;
    } else {
      line += ch;
    }
  }
  if (line) out.push(line);
  return out;
}

function dashedLine(ctx: CanvasRenderingContext2D, x1: number, x2: number, y: number) {
  ctx.save();
  ctx.setLineDash([10, 10]);
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
  ctx.restore();
}

/** "Monday, 03 Aug 2026 · 10:06 PM" */
function stamp(d: Date): string {
  const date = d.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true }).toUpperCase();
  return `${date} · ${time}`;
}

/** Draw the receipt onto a canvas sized exactly to its content. */
export async function renderReceiptCanvas(input: ReceiptImageInput): Promise<HTMLCanvasElement | null> {
  if (typeof document === "undefined") return null;

  const font = fontStack();
  const logo = await loadLogo();
  const when = stamp(input.date ?? new Date());

  // ---- measure first, so the canvas is exactly as tall as the content ----
  const probe = document.createElement("canvas").getContext("2d");
  if (!probe) return null;

  const cardX = PAD;
  const cardW = W - PAD * 2;
  const innerX = cardX + 44;
  const innerW = cardW - 88;

  const fields = input.fields.filter((f) => f.value);
  const valueLines: string[][] = fields.map((f) => {
    probe.font = f.mono ? `500 30px ${MONO}` : `600 34px ${font}`;
    return f.mono ? wrapHard(probe, f.value, innerW) : wrap(probe, f.value, innerW);
  });

  const ROW_TOP = 34; // padding above a row's label
  const LABEL_H = 38;
  const LINE_H = 44;
  const ROW_BOTTOM = 30;
  const rowHeights = valueLines.map(
    (ls, i) => ROW_TOP + (fields[i].label ? LABEL_H : 0) + ls.length * LINE_H + ROW_BOTTOM,
  );

  const heroTop = 250;
  const heroH = 100 + 52 + (input.status ? 86 : 20); // amount + date + status pill
  const cardTop = heroTop + heroH + 40;
  const cardH = rowHeights.reduce((a, b) => a + b, 0) + 16;
  const H = cardTop + cardH + 150;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // ---- background ------------------------------------------------------
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, 260, 0, W / 2, 260, 700);
  glow.addColorStop(0, "rgba(61,245,176,0.09)");
  glow.addColorStop(1, "rgba(61,245,176,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, cardTop);

  ctx.textBaseline = "middle";

  // ---- header: logo + wordmark, category badge on the right -------------
  if (logo) {
    ctx.save();
    roundRect(ctx, PAD, 62, 76, 76, 22);
    ctx.clip();
    ctx.drawImage(logo, PAD, 62, 76, 76);
    ctx.restore();
  }
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `700 42px ${font}`;
  ctx.textAlign = "left";
  ctx.fillText(COMPANY.product, PAD + (logo ? 96 : 0), 100);

  if (input.badge) {
    ctx.font = `600 26px ${font}`;
    const bw = ctx.measureText(input.badge).width + 52;
    roundRect(ctx, W - PAD - bw, 74, bw, 52, 26);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.textAlign = "center";
    ctx.fillText(input.badge, W - PAD - bw / 2, 101);
  }

  // ---- hero: the amount, big and bold -----------------------------------
  ctx.textAlign = "center";
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `700 96px ${font}`;
  ctx.fillText(input.amount, W / 2, heroTop + 40);

  ctx.fillStyle = "rgba(255,255,255,0.50)";
  ctx.font = `500 28px ${font}`;
  ctx.fillText(when, W / 2, heroTop + 122);

  if (input.status) {
    const tone = input.status.tone === "good" ? GREEN : AMBER;
    ctx.font = `600 27px ${font}`;
    const pw = ctx.measureText(input.status.label).width + 76;
    const py = heroTop + 160;
    roundRect(ctx, W / 2 - pw / 2, py, pw, 56, 28);
    ctx.fillStyle = input.status.tone === "good" ? "rgba(61,245,176,0.12)" : "rgba(255,196,107,0.12)";
    ctx.fill();
    // A small dot before the text reads as a live status, not a label.
    ctx.beginPath();
    ctx.arc(W / 2 - pw / 2 + 32, py + 28, 7, 0, Math.PI * 2);
    ctx.fillStyle = tone;
    ctx.fill();
    ctx.fillStyle = tone;
    ctx.fillText(input.status.label, W / 2 + 14, py + 29);
  }

  // ---- detail card ------------------------------------------------------
  roundRect(ctx, cardX, cardTop, cardW, cardH, 40);
  ctx.fillStyle = CARD;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textAlign = "left";
  let y = cardTop + 8;

  for (const [i, f] of fields.entries()) {
    y += ROW_TOP;

    if (f.label) {
      ctx.fillStyle = "rgba(255,255,255,0.42)";
      ctx.font = `500 27px ${font}`;
      ctx.fillText(f.label, innerX, y + 12);
      y += LABEL_H;
    }

    ctx.fillStyle = "rgba(255,255,255,0.94)";
    ctx.font = f.mono ? `500 30px ${MONO}` : `600 34px ${font}`;
    for (const line of valueLines[i]) {
      ctx.fillText(line, innerX, y + 16);
      y += LINE_H;
    }

    y += ROW_BOTTOM;
    if (i < fields.length - 1) dashedLine(ctx, innerX, cardX + cardW - 44, y - ROW_BOTTOM / 2);
  }

  // ---- footer -----------------------------------------------------------
  const bar = ctx.createLinearGradient(W / 2 - 60, 0, W / 2 + 60, 0);
  bar.addColorStop(0, CYAN);
  bar.addColorStop(1, GREEN);
  roundRect(ctx, W / 2 - 60, H - 100, 120, 6, 3);
  ctx.fillStyle = bar;
  ctx.fill();

  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.42)";
  ctx.font = `500 26px ${font}`;
  ctx.fillText(`Sent with ${COMPANY.product} · ${COMPANY.domain}`, W / 2, H - 54);

  return canvas;
}

export async function buildReceiptImage(input: ReceiptImageInput): Promise<Blob | null> {
  const canvas = await renderReceiptCanvas(input);
  if (!canvas) return null;
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}
