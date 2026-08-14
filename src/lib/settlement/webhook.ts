import crypto from "crypto";
import { couldBeAddress } from "./asset-resolve";
import type { NormalizedDeposit } from "./types";

/**
 * Pure webhook helpers — no server-only / Prisma imports, so they can be unit
 * tested in plain Node and reused by the route handlers.
 */

/**
 * Verify an inbound crypto-deposit webhook. The provider signs the raw request
 * body with HMAC-SHA256 using DEPOSIT_WEBHOOK_SECRET and sends the hex digest in
 * the `x-ttip-signature` header. Constant-time comparison.
 */
export function verifyDepositSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.DEPOSIT_WEBHOOK_SECRET || null;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Parse an inbound deposit body into a NormalizedDeposit.
 *
 * Generic contract: { id, address, asset, chain, amount, status? }
 * (aliases accepted: externalId/txHash for id, currency for asset, network for chain)
 */
export function parseDeposit(body: unknown): NormalizedDeposit {
  const b = (body ?? {}) as Record<string, unknown>;
  const externalId = String(b.id ?? b.externalId ?? b.txHash ?? "");
  const address = String(b.address ?? "");
  const asset = String(b.asset ?? b.currency ?? "").toUpperCase();
  const chain = String(b.chain ?? b.network ?? "").toLowerCase();
  const amount = Number(b.amount ?? 0);
  const status = (b.status === "pending" ? "pending" : "confirmed") as NormalizedDeposit["status"];
  if (!externalId || !address || !asset || !(amount > 0)) {
    throw new Error("Invalid deposit payload: id, address, asset and a positive amount are required.");
  }
  return { externalId, address, asset, chain, amount, status, provider: String(b.provider ?? "generic"), raw: body };
}

/**
 * Verify a Dextopus deposit webhook.
 *
 * WHAT WE HAD WRONG, and it cost real deposits: we computed the digest over
 * `{timestamp}.{rawBody}` and REQUIRED an `X-Signature-Timestamp` header. The
 * working Sweepflow integration signs the RAW BODY ALONE and treats the
 * timestamp as an optional staleness check. So every signature mismatched, the
 * route answered 401, and nothing was written down at all — the funds settled
 * into treasury and the app had no idea the deposit existed. That is exactly
 * the "it reached the treasury but never showed up" report.
 *
 * Both schemes are now accepted: body-only first, then the timestamped variant,
 * so a provider that does prefix the timestamp still verifies. Comparison is
 * constant-time, and a missing or unparseable timestamp only skips the replay
 * window rather than failing the whole check.
 */
export function verifyDextopusSignature(
  timestamp: string | null,
  rawBody: string,
  signature: string | null,
  maxAgeMs = 5 * 60_000,
): boolean {
  const secret = process.env.DEXTOPUS_WEBHOOK_SECRET || null;
  if (!secret || !signature) return false;

  // Some providers prefix the algorithm; strip it before comparing.
  const given = signature.trim().replace(/^sha256=/i, "");
  if (!given) return false;

  // Replay window, only when a timestamp was actually sent. Its absence must
  // not fail the signature — it simply means we can't age-check this one.
  const ts = Number(timestamp);
  if (timestamp && Number.isFinite(ts) && Math.abs(Date.now() - ts) > maxAgeMs) return false;

  const candidates = [rawBody];
  if (timestamp) candidates.push(`${timestamp}.${rawBody}`);

  return candidates.some((payload) => {
    const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(given);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

/**
 * Map a Dextopus webhook body to a NormalizedDeposit. What lands in your
 * treasury is the *settlement* asset (Dextopus cross-chain-settles the user's
 * origin asset to your configured treasury asset/address), so we credit that.
 * Only `deposit.completed` (status COMPLETED) is confirmed.
 */
export function parseDextopusDeposit(body: unknown): NormalizedDeposit {
  const b = (body ?? {}) as { event?: string; data?: Record<string, unknown> };
  const d = b.data ?? {};
  // `id` is NOT a guess — it is what production told us.
  //
  // The poller reported, ten times over, against real records:
  //
  //   parse-failed: requestId, a settlement/origin asset and a positive amount
  //   are required  [keys: id,userId,depositAddress,…]
  //
  // The WEBHOOK payload names this `requestId`. The REST list endpoint that the
  // poller reads names it `id`. Same deposit, two shapes, and the parser only
  // knew the first — so every polled record threw on line one and was counted
  // as "skipped" with no reason attached. The webhook was rejected on signature
  // and the poller couldn't read the format: both doors shut, money in treasury,
  // nothing in the app.
  const externalId = String(d.requestId ?? d.depositId ?? d.id ?? "");

  // What actually SETTLED into treasury — the amount we can honestly credit.
  // Dextopus can report it under several names; a settlement amount hiding under
  // an unchecked key is exactly how a 1.3 SOL deposit became "1.3 USDC": the
  // parse missed it, fell back to the ORIGIN (SOL) amount, and the route then
  // relabelled that origin quantity to the settlement asset. So we look widely.
  // FORMATTED FIRST, AND NEVER SILENTLY MIXED.
  //
  // Dextopus reports amounts in BASE UNITS. Falling from a "…Formatted" key
  // through to its unformatted sibling and treating both the same is what
  // credited 725902 for a 0.725902 USDC deposit, and 10290000000000000000 for
  // 10.29 USDT. The two are different units and must be labelled as such.
  const settlementFormatted = firstPositive(
    d.settlementAmountFormatted, d.destinationAmountFormatted,
    d.amountOutFormatted, d.settledAmountFormatted,
  );
  const settlementRaw = firstString(d.settlementAmount, d.destinationAmount, d.amountOut, d.settledAmount);
  const settlementAmount = settlementFormatted || Number(settlementRaw || 0);
  const settlementAsset = String(d.settlementAsset ?? d.destinationAsset ?? d.settlementToken ?? "");

  // What the user sent (origin) — the fallback, and what we show as the source.
  const originFormatted = firstPositive(d.originAmountFormatted, d.amountInFormatted);
  const originRaw = firstString(d.originAmount, d.amountIn);
  const originAmount = originFormatted || Number(originRaw || 0);
  const originAsset = String(d.originAsset ?? d.sourceAsset ?? "");

  // Credit asset and amount MUST come from the same side. Prefer the settlement
  // pair (what treasury received); fall back to the origin pair. NEVER mix the
  // settlement asset with the origin amount.
  let asset: string;
  let amount: number;
  let settled: boolean;
  let amountIsRaw: boolean;
  let rawAmount: string | undefined;
  if (settlementAmount > 0 && settlementAsset) {
    asset = settlementAsset;
    amount = settlementAmount;
    settled = true;
    amountIsRaw = !settlementFormatted;
    rawAmount = settlementFormatted ? undefined : settlementRaw;
  } else {
    asset = originAsset;
    amount = originAmount;
    settled = false;
    amountIsRaw = !originFormatted;
    rawAmount = originFormatted ? undefined : originRaw;
  }

  // Where the user actually sent from (origin) is what to show them.
  const chain = String(d.originChainId ?? d.settlementChainId ?? "");
  // A settled deposit, by any of the names a provider might give it.
  //
  // This required the exact string "COMPLETED". Anything else — SUCCESS,
  // SETTLED, COMPLETE, CONFIRMED — made the deposit "pending", and
  // creditDeposit then returned "not yet confirmed" WITHOUT WRITING ANYTHING.
  // No settlement, no transaction, no held row, nothing in any log. Money in
  // treasury and not one trace of it in the app: the exact report, and the only
  // gate here that leaves no evidence at all.
  //
  // The poller is worse hit than the webhook, because it reads REST records
  // that carry no event name, so the status string is the only signal it has.
  const DONE = new Set([
    "COMPLETED", "COMPLETE", "SUCCESS", "SUCCESSFUL", "SETTLED", "CONFIRMED", "DONE", "FINISHED", "PAID",
  ]);
  const statusText = String(d.status ?? d.state ?? d.depositStatus ?? "").toUpperCase().trim();
  const confirmed = DONE.has(statusText) || b.event === "deposit.completed";
  if (!externalId || !asset || !(amount > 0)) {
    throw new Error("Invalid Dextopus payload: requestId, a settlement/origin asset and a positive amount are required.");
  }
  return {
    externalId,
    address: String(d.depositAddress ?? ""),
    // A ticker is normalised; an ADDRESS is left exactly as sent. Upper-casing a
    // mint destroys it — EPjFWdd5… became EPJFWDD5…, which matched no ticker and
    // no base58 pattern, and the deposit was held instead of credited.
    asset: couldBeAddress(asset) ? asset : asset.toUpperCase(),
    chain,
    amount,
    status: confirmed ? "confirmed" : "pending",
    amountIsRaw,
    rawAmount,
    provider: "dextopus",
    settled,
    userId: d.userId ? String(d.userId) : undefined,
    txHash: String(d.originTxHash ?? d.settlementTxHash ?? "") || undefined,
    chainId: Number(d.originChainId ?? d.settlementChainId) || undefined,
    raw: body,
  };
}

/** First strictly-positive finite number among the candidates, else 0. */
/** The first present value, kept as a STRING so big integers stay exact. */
function firstString(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return String(v);
    if (typeof v === "bigint") return v.toString();
  }
  return undefined;
}

function firstPositive(...vals: unknown[]): number {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

/** Paystack amounts are in the currency's smallest unit (kobo/pesewas). */
export function toSubunit(amount: number): number {
  return Math.round(amount * 100);
}

/** Verify a Paystack webhook (HMAC-SHA512 of the raw body with the secret key). */
export function verifyPaystackWebhook(rawBody: string, signature: string | null): boolean {
  const secret = process.env.PAYSTACK_SECRET_KEY || null;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha512", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
