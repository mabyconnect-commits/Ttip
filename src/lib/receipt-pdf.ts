import { renderReceiptCanvas, type ReceiptImageInput } from "./receipt-image";

/**
 * Wrap the rendered receipt in a one-page PDF.
 *
 * A PDF is what people forward to an employer, a landlord or a bank — an image
 * gets recompressed by chat apps, a PDF doesn't, and it prints at a sane size.
 *
 * Written by hand rather than pulling in a PDF library: the document is a single
 * full-bleed image, which is about sixty lines of PDF and no new dependency in a
 * money app. The image goes in as JPEG so it can be embedded with DCTDecode
 * exactly as the encoder produced it — no pixel re-encoding, no compression code.
 *
 * Browser-only.
 */

const enc = new TextEncoder();

function toBytes(chunk: string | Uint8Array): Uint8Array {
  return typeof chunk === "string" ? enc.encode(chunk) : chunk;
}

/** Concatenate chunks, recording the byte offset each object starts at. */
function assemble(parts: (string | Uint8Array)[]): Uint8Array<ArrayBuffer> {
  const bytes = parts.map(toBytes);
  const total = bytes.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(new ArrayBuffer(total));
  let at = 0;
  for (const b of bytes) {
    out.set(b, at);
    at += b.length;
  }
  return out;
}

function byteLength(chunk: string | Uint8Array): number {
  return toBytes(chunk).length;
}

/** 10-digit, zero-padded xref offset. */
function pad10(n: number): string {
  return n.toString().padStart(10, "0");
}

export async function buildReceiptPdf(input: ReceiptImageInput): Promise<Blob | null> {
  const canvas = await renderReceiptCanvas(input);
  if (!canvas) return null;

  const jpeg: Blob | null = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", 0.94),
  );
  if (!jpeg) return null;
  const jpegBytes = new Uint8Array(await jpeg.arrayBuffer());

  // Lay the image out at A4 width, keeping its aspect ratio.
  const pageW = 595.28;
  const pageH = (canvas.height / canvas.width) * pageW;

  const objects: (string | Uint8Array)[][] = [
    ["1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"],
    ["2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"],
    [
      "3 0 obj\n<< /Type /Page /Parent 2 0 R " +
        `/MediaBox [0 0 ${pageW.toFixed(2)} ${pageH.toFixed(2)}] ` +
        "/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    ],
    [
      "4 0 obj\n<< /Type /XObject /Subtype /Image " +
        `/Width ${canvas.width} /Height ${canvas.height} ` +
        "/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode " +
        `/Length ${jpegBytes.length} >>\nstream\n`,
      jpegBytes,
      "\nendstream\nendobj\n",
    ],
    [],
  ];

  // Content stream: draw the image across the whole page.
  const content = `q\n${pageW.toFixed(2)} 0 0 ${pageH.toFixed(2)} 0 0 cm\n/Im0 Do\nQ\n`;
  objects[4] = [`5 0 obj\n<< /Length ${byteLength(content)} >>\nstream\n`, content, "endstream\nendobj\n"];

  const header = "%PDF-1.4\n%\xFF\xFF\xFF\xFF\n";
  const parts: (string | Uint8Array)[] = [header];
  const offsets: number[] = [];
  let at = byteLength(header);

  for (const obj of objects) {
    offsets.push(at);
    for (const chunk of obj) {
      parts.push(chunk);
      at += byteLength(chunk);
    }
  }

  const xrefAt = at;
  const xref =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${pad10(o)} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  parts.push(xref);

  return new Blob([assemble(parts)], { type: "application/pdf" });
}
