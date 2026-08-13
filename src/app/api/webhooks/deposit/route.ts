import { NextResponse } from "next/server";
import { scaleDepositAmount } from "@/lib/settlement/deposit-amount";
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
/**
 * Health check. Paste the URL into a browser to see whether this deployment is
 * actually wired up — the reference integration does the same, and it is the
 * fastest way to tell a config problem from a code one without reading logs.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "ttip-deposit-webhook",
    hasDextopusSecret: Boolean(process.env.DEXTOPUS_WEBHOOK_SECRET),
    hasGenericSecret: Boolean(process.env.DEPOSIT_WEBHOOK_SECRET),
    settlementAssetConfigured: Boolean(process.env.DEXTOPUS_SETTLEMENT_ASSET),
  });
}

export async function POST(req: Request) {
  const raw = await req.text();
  // Providers differ on the header name, and picking only one is how a
  // correctly-signed webhook gets treated as unsigned and thrown away.
  const dextopusSig =
    req.headers.get("x-signature-sha256") ??
    req.headers.get("x-dextopus-signature") ??
    req.headers.get("x-webhook-signature") ??
    req.headers.get("x-signature");

  try {
    if (dextopusSig) {
      const ts = req.headers.get("x-signature-timestamp");
      if (!verifyDextopusSignature(ts, raw, dextopusSig)) {
        // Logged with enough detail to diagnose without leaking the secret. A
        // silent 401 here is money vanishing: the funds settle into treasury and
        // nothing is ever written down.
        console.error("[deposit] signature rejected — deposit NOT recorded", {
          bytes: raw.length,
          haveSecret: Boolean(process.env.DEXTOPUS_WEBHOOK_SECRET),
          receivedPrefix: dextopusSig.slice(0, 8),
          hadTimestamp: Boolean(ts),
        });
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
      let deposit = parseDextopusDeposit(payload);

      // Dextopus reports amounts in BASE UNITS unless it sent a "…Formatted"
      // field. Scale before anything else touches the number — crediting the
      // base-unit integer is what put 725,902 USDC in a wallet for a deposit
      // worth 73 cents. A 503 rather than a silent drop: nothing is credited,
      // and the provider retries once the catalogue can name the token.
      const scaled = await scaleDepositAmount(deposit);
      if (!scaled.deposit) {
        console.error("[deposit] refusing to credit an unscalable amount", {
          externalId: deposit.externalId,
          asset: deposit.asset,
          rawAmount: deposit.rawAmount,
          reason: scaled.reason,
        });
        return NextResponse.json({ error: `cannot scale amount: ${scaled.reason}` }, { status: 503 });
      }
      deposit = scaled.deposit;
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
