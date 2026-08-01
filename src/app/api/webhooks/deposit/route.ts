import { NextResponse } from "next/server";
import { creditDeposit, parseDeposit, verifyDepositSignature } from "@/lib/settlement";
import { verifyDextopusSignature } from "@/lib/settlement/webhook";

export const dynamic = "force-dynamic";

/**
 * Inbound crypto-deposit webhook. The deposit provider (Dextopus, or the sandbox
 * simulator) calls this when funds land at a user's deposit address and are
 * swept into treasury. The raw body is HMAC-signed; we verify, then credit the
 * user's balance idempotently.
 *
 * Auth is by signature only — there is no session here, the caller is a machine.
 * Dextopus signs with its own secret + header; the generic contract uses ours.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const dextopusSig = req.headers.get("x-dextopus-signature");
  const verified = dextopusSig
    ? verifyDextopusSignature(raw, dextopusSig)
    : verifyDepositSignature(raw, req.headers.get("x-ttip-signature"));

  if (!verified) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let deposit;
  try {
    deposit = parseDeposit(JSON.parse(raw));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 422 });
  }

  try {
    const result = await creditDeposit(deposit);
    // Always 200 for a valid, signed event so the provider stops retrying —
    // "no user for address" and "duplicate" are terminal, not transient.
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    // Unexpected/transient error — 500 so the provider retries.
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
