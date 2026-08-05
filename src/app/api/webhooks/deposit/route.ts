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

      // Do NOT rewrite deposit.asset here. This used to force the symbol to
      // DEXTOPUS_SETTLEMENT_ASSET while leaving `amount` untouched, which
      // relabelled 0.4 SOL as 0.4 USDC — same number, different currency,
      // ~$60 of value destroyed. The parser now returns a matched
      // settlement asset+amount pair; if the provider ever sends a symbol we
      // don't expect, refuse rather than rename it.
      const expected = (process.env.DEXTOPUS_SETTLEMENT_ASSET || "").toUpperCase();
      if (expected && deposit.asset !== expected) {
        console.error("[deposit] settlement asset mismatch — not crediting", {
          externalId: deposit.externalId,
          got: deposit.asset,
          expected,
          amount: deposit.amount,
          originAsset: deposit.originAsset,
          originAmount: deposit.originAmount,
        });
        return NextResponse.json(
          {
            ok: false,
            error: `Settlement asset ${deposit.asset} does not match the configured treasury asset ${expected}. Held for review.`,
          },
          { status: 409 },
        );
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
