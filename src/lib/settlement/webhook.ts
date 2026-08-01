import crypto from "crypto";
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
  const asset = String(d.settlementAsset ?? d.originAsset ?? "").toUpperCase();
  const amount = Number(d.settlementAmountFormatted ?? d.originAmountFormatted ?? 0);
  const chain = String(d.settlementChainId ?? d.originChainId ?? "").toLowerCase();
  const confirmed = String(d.status ?? "").toUpperCase() === "COMPLETED" || b.event === "deposit.completed";
  if (!externalId || !asset || !(amount > 0)) {
    throw new Error("Invalid Dextopus payload: requestId, settlementAsset and a positive amount are required.");
  }
  return {
    externalId,
    address: String(d.depositAddress ?? ""),
    asset,
    chain,
    amount,
    status: confirmed ? "confirmed" : "pending",
    provider: "dextopus",
    userId: d.userId ? String(d.userId) : undefined,
    raw: body,
  };
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
