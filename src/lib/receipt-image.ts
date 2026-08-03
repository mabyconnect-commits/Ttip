import { COMPANY } from "./company";

/**
 * Draw a Ttip receipt as a PNG the user can send to whoever they paid.
 *
 * The first version shared plain text, which landed in WhatsApp as an unbranded
 * green message bubble — indistinguishable from someone typing the numbers
 * themselves, which is exactly the opposite of proof. A receipt has to LOOK like
 * a receipt: logo, amount, details, reference.
 *
 * Canvas rather than a screenshot library so there's no new dependency and no
 * dependence on what's currently on screen — the image is drawn from the same
 * data the success screen was given.
 *
 * Browser-only: it touches document/canvas, so call it from a client component.
 */

export interface ReceiptImageInput {
  /** e.g. "Sent" / "Transfer successful" */
  title: string;
  /** The headline line, e.g. "₦260.69 on the way". */
  primary?: string;
  /** Supporting rows, e.g. "To Opay (Paycom) ••6493", "Transfer fee ₦12.00". */
  rows: string[];
  reference?: string | null;
  /** Defaults to now. */
  date?: Date;
}

const W = 1080;
const PAD = 72;
const GREEN = "#3DF5B0";
const CYAN = "#2AC8FF";
const BG = "#0A0C13";
const CARD = "#11141C";

/** The app's own font stack, so the receipt matches the product. */
function fontStack(): string {
  try {
    const f = getComputedStyle(document.body).fontFamily;
    if (f) return f;
  } catch {}
  return 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
}

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

/** Split `text` into lines that fit `maxWidth` at the ctx's current font. */
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

export async function buildReceiptImage(input: ReceiptImageInput): Promise<Blob | null> {
  if (typeof document === "undefined") return null;

  const font = fontStack();
  const logo = await loadLogo();
  const when = (input.date ?? new Date()).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  // Measure first so the canvas is exactly as tall as the content needs.
  const probe = document.createElement("canvas").getContext("2d");
  if (!probe) return null;

  const innerW = W - PAD * 2 - 56; // card padding on both sides
  const rowLines: string[][] = [];
  probe.font = `500 30px ${font}`;
  for (const r of input.rows) rowLines.push(wrap(probe, r, innerW));

  probe.font = `500 28px ui-monospace, SFMono-Regular, Menlo, monospace`;
  const refLines = input.reference ? wrapHard(probe, input.reference, innerW) : [];

  const rowsHeight =
    rowLines.reduce((h, ls) => h + ls.length * 40 + 30, 0) +
    56 + // date row
    (refLines.length ? refLines.length * 36 + 40 : 0);

  const cardTop = 690;
  const cardHeight = rowsHeight + 56;
  const H = cardTop + cardHeight + 190;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // ---- background -------------------------------------------------------
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, 300, 0, W / 2, 300, 620);
  glow.addColorStop(0, "rgba(61,245,176,0.10)");
  glow.addColorStop(1, "rgba(61,245,176,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, 900);

  // ---- header: logo + wordmark + "RECEIPT" ------------------------------
  if (logo) {
    ctx.save();
    roundRect(ctx, PAD, 64, 88, 88, 24);
    ctx.clip();
    ctx.drawImage(logo, PAD, 64, 88, 88);
    ctx.restore();
  }
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `700 46px ${font}`;
  ctx.textBaseline = "middle";
  ctx.fillText(COMPANY.product, PAD + (logo ? 112 : 0), 110);

  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(255,255,255,0.38)";
  ctx.font = `600 26px ${font}`;
  ctx.fillText("RECEIPT", W - PAD, 110);
  ctx.textAlign = "left";

  // ---- success mark -----------------------------------------------------
  const cx = W / 2;
  const cy = 300;
  ctx.beginPath();
  ctx.arc(cx, cy, 62, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(61,245,176,0.07)";
  ctx.fill();
  ctx.strokeStyle = "rgba(61,245,176,0.32)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx - 24, cy + 2);
  ctx.lineTo(cx - 6, cy + 20);
  ctx.lineTo(cx + 26, cy - 20);
  ctx.strokeStyle = GREEN;
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();

  // ---- title + headline amount ------------------------------------------
  ctx.textAlign = "center";
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `700 62px ${font}`;
  ctx.fillText(input.title, cx, 460);

  if (input.primary) {
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.font = `500 34px ${font}`;
    for (const [i, l] of wrap(ctx, input.primary, W - PAD * 2).entries()) {
      ctx.fillText(l, cx, 540 + i * 46);
    }
  }
  ctx.textAlign = "left";

  // ---- detail card ------------------------------------------------------
  roundRect(ctx, PAD, cardTop, W - PAD * 2, cardHeight, 40);
  ctx.fillStyle = CARD;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth = 2;
  ctx.stroke();

  let y = cardTop + 28;
  const x = PAD + 28;

  for (const lines of rowLines) {
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.font = `500 30px ${font}`;
    for (const l of lines) {
      ctx.fillText(l, x, y + 24);
      y += 40;
    }
    y += 30;
  }

  // Date on one row, label left / value right.
  ctx.fillStyle = "rgba(255,255,255,0.40)";
  ctx.font = `500 28px ${font}`;
  ctx.fillText("Date", x, y + 20);
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillText(when, W - PAD - 28, y + 20);
  ctx.textAlign = "left";
  y += 56;

  if (refLines.length) {
    ctx.fillStyle = "rgba(255,255,255,0.40)";
    ctx.font = `500 28px ${font}`;
    ctx.fillText("Reference", x, y + 18);
    y += 40;
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.font = `500 28px ui-monospace, SFMono-Regular, Menlo, monospace`;
    for (const l of refLines) {
      ctx.fillText(l, x, y + 14);
      y += 36;
    }
  }

  // ---- footer -----------------------------------------------------------
  const barY = H - 108;
  const bar = ctx.createLinearGradient(PAD, 0, W - PAD, 0);
  bar.addColorStop(0, CYAN);
  bar.addColorStop(1, GREEN);
  roundRect(ctx, cx - 60, barY, 120, 6, 3);
  ctx.fillStyle = bar;
  ctx.fill();

  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.font = `500 27px ${font}`;
  ctx.fillText(`Sent with ${COMPANY.product} · ${COMPANY.domain}`, cx, H - 60);

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}
