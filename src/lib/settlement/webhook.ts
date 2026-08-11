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
 * Verify a Dextopus deposit webhook. Dextopus signs
 * `HMAC-SHA256("{timestamp}.{rawBody}", webhookSecret)` and sends the hex digest
 * in `X-Signature-SHA256` with the ms timestamp in `X-Signature-Timestamp`.
 * Optionally rejects timestamps older than `maxAgeMs` (default 5 min) to stop
 * replay.
 */
export function verifyDextopusSignature(
  timestamp: string | null,
  rawBody: string,
  signature: string | null,
  maxAgeMs = 5 * 60_000,
): boolean {
  const secret = process.env.DEXTOPUS_WEBHOOK_SECRET || null;
  if (!secret || !signature || !timestamp) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > maxAgeMs) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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
  const externalId = String(d.requestId ?? d.depositId ?? "");

  // What actually SETTLED into treasury — the amount we can honestly credit.
  // Dextopus can report it under several names; a settlement amount hiding under
  // an unchecked key is exactly how a 1.3 SOL deposit became "1.3 USDC": the
  // parse missed it, fell back to the ORIGIN (SOL) amount, and the route then
  // relabelled that origin quantity to the settlement asset. So we look widely.
  // FORMATTED FIELDS ONLY, unless nothing formatted exists.
  //
  // The unformatted fields carry RAW BASE UNITS. A 10.29 USDT deposit on an
  // 18-decimal token is 10290000000000000000 there, and crediting that number
  // put ten quintillion USDT in someone's wallet. Every "…Formatted" key is
  // tried first, and a raw value is only considered when the provider sent no
  // formatted one at all — at which point the sanity ceiling in creditDeposit
  // is what stops it reaching a balance.
  const settlementAmount = firstPositive(
    d.settlementAmountFormatted, d.destinationAmountFormatted, d.amountOutFormatted, d.settledAmountFormatted,
  ) || firstPositive(d.settlementAmount, d.destinationAmount, d.amountOut, d.settledAmount);
  const settlementAsset = String(d.settlementAsset ?? d.destinationAsset ?? d.settlementToken ?? "");

  // What the user sent (origin) — the fallback, and what we show as the source.
  const originAmount =
    firstPositive(d.originAmountFormatted, d.amountInFormatted) || firstPositive(d.originAmount, d.amountIn);
  const originAsset = String(d.originAsset ?? d.sourceAsset ?? "");

  // Credit asset and amount MUST come from the same side. Prefer the settlement
  // pair (what treasury received); fall back to the origin pair. NEVER mix the
  // settlement asset with the origin amount.
  let asset: string;
  let amount: number;
  let settled: boolean;
  if (settlementAmount > 0 && settlementAsset) {
    asset = settlementAsset; amount = settlementAmount; settled = true;
  } else {
    asset = originAsset; amount = originAmount; settled = false;
  }

  // Where the user actually sent from (origin) is what to show them.
  const chain = String(d.originChainId ?? d.settlementChainId ?? "");
  const confirmed = String(d.status ?? "").toUpperCase() === "COMPLETED" || b.event === "deposit.completed";
  if (!externalId || !asset || !(amount > 0)) {
    throw new Error("Invalid Dextopus payload: requestId, a settlement/origin asset and a positive amount are required.");
  }
  return {
    externalId,
    address: String(d.depositAddress ?? ""),
    // A ticker is normalised; an ADDRESS is left exactly as sent. Upper-casing
    // an address destroys it — `0xa0b8…` becomes `0XA0B8…`, and a Tron address
    // gains letters base58 doesn't use — after which every shape test rejects
    // it as junk and a real deposit is held instead of credited.
    asset: couldBeAddress(asset) ? asset : asset.toUpperCase(),
    chain,
    amount,
    status: confirmed ? "confirmed" : "pending",
    provider: "dextopus",
    settled,
    userId: d.userId ? String(d.userId) : undefined,
    txHash: String(d.originTxHash ?? d.settlementTxHash ?? "") || undefined,
    chainId: Number(d.originChainId ?? d.settlementChainId) || undefined,
    raw: body,
  };
}

/** First strictly-positive finite number among the candidates, else 0. */
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
