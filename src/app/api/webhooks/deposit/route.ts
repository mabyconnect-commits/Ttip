import { NextResponse } from "next/server";
import {
  creditDeposit,
  parseDeposit,
  parseDextopusDeposit,
  verifyDepositSignature,
  verifyDextopusSignature,
} from "@/lib/settlement";

export const dynamic = "force-dynamic";

/**
 * Inbound crypto-deposit webhook. The deposit provider (Dextopus, or the sandbox
 * simulator) calls this when funds land at a user's deposit address and settle
 * into treasury. We verify the signature, then credit the user's balance
 * idempotently. Auth is by signature only — the caller is a machine.
 *
 * Two schemes are accepted:
 *   - Dextopus: `X-Signature-SHA256` + `X-Signature-Timestamp`, payload maps via
 *     parseDextopusDeposit (user resolved from the echoed userId).
 *   - Generic/sandbox: `x-ttip-signature`, payload maps via parseDeposit.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const dextopusSig = req.headers.get("x-signature-sha256");

  try {
    if (dextopusSig) {
      const ts = req.headers.get("x-signature-timestamp");
      if (!verifyDextopusSignature(ts, raw, dextopusSig)) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
      const deposit = parseDextopusDeposit(JSON.parse(raw));
      const result = await creditDeposit(deposit);
      return NextResponse.json({ ok: true, ...result });
    }

    if (!verifyDepositSignature(raw, req.headers.get("x-ttip-signature"))) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
    const deposit = parseDeposit(JSON.parse(raw));
    const result = await creditDeposit(deposit);
    // Always 200 for a valid, signed event so the provider stops retrying —
    // "no user for address" and "duplicate" are terminal, not transient.
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    // JSON/parse errors are the caller's fault (422); unexpected errors 500 so
    // the provider retries.
    const msg = (e as Error).message;
    const status = msg.includes("Invalid") || msg.includes("payload") ? 422 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
