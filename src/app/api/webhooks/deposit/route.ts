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
      const payload = JSON.parse(raw);
      // Safety: Ttip withdrawals reuse the deposit rails (treasury → Dextopus →
      // user). Those events must NEVER credit a user — skip them here so a
      // withdrawal can't also add balance. They finalize via status polling.
      const meta = payload?.data?.metadata ?? payload?.metadata;
      if (meta?.source === "ttip-withdrawal") {
        return NextResponse.json({ ok: true, ignored: "withdrawal" });
      }
      const deposit = parseDextopusDeposit(payload);
      // A Dextopus deposit cross-chain-settles to our treasury asset, which the
      // payload may report as a mint/contract ADDRESS. Relabel that to our
      // configured symbol — but ONLY when the credited amount is the SETTLEMENT
      // amount (deposit.settled). Relabelling an ORIGIN-amount credit to the
      // settlement asset is the mis-credit that turned 1.3 SOL into "1.3 USDC",
      // so an origin-pair credit keeps its own asset.
      if (deposit.settled && process.env.DEXTOPUS_SETTLEMENT_ASSET) {
        deposit.asset = process.env.DEXTOPUS_SETTLEMENT_ASSET.toUpperCase();
      }
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
