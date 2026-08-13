import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { scaleDepositAmount } from "@/lib/settlement/deposit-amount";
import { resolveDepositAsset } from "@/lib/settlement/asset-resolve";
import { reconcileDeposits } from "@/lib/settlement/deposit-reconcile";
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

/**
 * A webhook we could not verify is still a doorbell. Answer the door.
 *
 * THE reason deposits only appeared after an admin pressed Sync. Everything
 * downstream of this route is provably fine — Sync runs the very same parser,
 * scaler and creditDeposit against the very same deposit and credits it
 * correctly. So the failure is not in the crediting. It is here, at the front
 * door: the event arrives, the HMAC doesn't match what we compute (a different
 * canonical form, a header we don't read, a rotated secret), we return 401, and
 * the money is silently dropped. The user then waits for a human.
 *
 * Rejecting an unverified PAYLOAD is right — its amounts and asset could be
 * anyone's invention. Rejecting the NEWS is what costs the deposit. So the
 * payload is thrown away and used only as a hint about WHO to ask, and then we
 * ask Dextopus ourselves over our authenticated API and credit strictly what
 * THEY report. Nothing in the request body can influence a balance.
 *
 * That makes the signature an optimisation rather than a single point of
 * failure: get it wrong and deposits still land in seconds.
 */
async function confirmWithProvider(raw: string, req: Request) {
  if (!raw || raw.length > 20_000) return null;

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  const b = (body ?? {}) as { data?: Record<string, unknown> } & Record<string, unknown>;
  const d = (b.data ?? b) as Record<string, unknown>;

  // The hint has to point at a deposit address WE issued. An unknown address is
  // a stranger poking the endpoint, and gets nothing — not even a lookup.
  const address = d.depositAddress ? String(d.depositAddress).trim() : "";
  const claimed = d.userId ? String(d.userId).trim() : "";

  let userId: string | null = null;
  if (address) {
    const row = await prisma.walletAddress.findFirst({
      where: { address, provider: "dextopus" },
      select: { userId: true },
    });
    userId = row?.userId ?? null;
  }
  if (!userId && claimed) {
    const row = await prisma.walletAddress.findFirst({
      where: { userId: claimed, provider: "dextopus" },
      select: { userId: true },
    });
    userId = row?.userId ?? null;
  }
  if (!userId) return null;

  // Cheap brake on anyone replaying a known address to make us call out.
  try {
    rateLimit(`deposit-confirm:${clientIp(req)}`, { limit: 60, windowMs: 60_000 });
  } catch {
    return null;
  }

  console.warn("[deposit] unverified webhook — confirming with the provider instead", { userId });
  return await reconcileDeposits(1, userId).catch((e) => {
    console.error("[deposit] provider confirmation failed", e);
    return null;
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
        const confirmed = await confirmWithProvider(raw, req);
        if (confirmed) {
          return NextResponse.json({ ok: true, verifiedBy: "provider-api", ...confirmed });
        }
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
      // THE ROOT CAUSE, closed at its source.
      //
      // DEXTOPUS_SETTLEMENT_ASSET carries two meanings at once. The address
      // minting code needs it to be a TOKEN ADDRESS — resolveTokenAddress
      // explicitly accepts one. This relabel was written assuming it is a
      // TICKER. It is configured as the Solana USDC mint, so this line wrote
      // "EPjFWdd5…" into deposit.asset as if it were a currency.
      //
      // Before 2026-08-09 that minted a junk balance row named after the mint.
      // On 2026-08-09 a guard was added refusing any asset that isn't a listed
      // ticker — correct in itself — and from that moment every settled deposit
      // was held instead of credited. That is the day deposits stopped working,
      // and it is exactly what users have been reporting since.
      //
      // So the address is resolved to its ticker HERE, and the settlement row
      // records "USDC" rather than a 44-character mint. If it can't be resolved
      // the raw value is left for creditDeposit to judge — never guessed at.
      if (deposit.settled && process.env.DEXTOPUS_SETTLEMENT_ASSET) {
        const configured = process.env.DEXTOPUS_SETTLEMENT_ASSET.trim();
        const ticker = await resolveDepositAsset(configured, deposit.chainId).catch(() => null);
        deposit.asset = ticker ?? configured;
      }
      const result = await creditDeposit(deposit);
      return NextResponse.json({ ok: true, ...result });
    }

    if (!verifyDepositSignature(raw, req.headers.get("x-ttip-signature"))) {
      // No signature header we recognise at all. If the body still names a
      // deposit address we issued, this is our provider using a header name we
      // haven't seen — same treatment: ask them, credit their answer.
      const confirmed = await confirmWithProvider(raw, req);
      if (confirmed) {
        return NextResponse.json({ ok: true, verifiedBy: "provider-api", ...confirmed });
      }
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
