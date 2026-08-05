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
 * Map a Dextopus webhook body to a NormalizedDeposit.
 *
 * Dextopus cross-chain-settles whatever the user sent (the *origin* asset) into
 * our configured treasury asset (the *settlement* asset). Those are two
 * different symbols with two different amounts, and this function keeps them
 * strictly paired:
 *
 *   asset / amount             ← settlementAsset + settlementAmountFormatted
 *   originAsset / originAmount ← originAsset + originAmountFormatted
 *
 * It deliberately does NOT fall back from one side to the other. A settlement
 * symbol carrying an origin amount is exactly how 0.4 SOL got credited as
 * 0.4 USDC — an incomplete settlement pair must fail loudly rather than
 * silently resolve to a wrong number.
 *
 * Only `deposit.completed` (status COMPLETED) is confirmed.
 */
export function parseDextopusDeposit(body: unknown): NormalizedDeposit {
  const b = (body ?? {}) as { event?: string; data?: Record<string, unknown> };
  const d = b.data ?? {};
  const externalId = String(d.requestId ?? d.depositId ?? "");

  // Settlement pair — read together, kept together. This is what we credit.
  const asset = String(d.settlementAsset ?? "").toUpperCase();
  const amount = Number(d.settlementAmountFormatted ?? NaN);

  // Origin pair — what the user actually sent. Shown to them, never credited.
  const originAsset = String(d.originAsset ?? "").toUpperCase() || undefined;
  const rawOrigin = Number(d.originAmountFormatted ?? NaN);
  const originAmount = Number.isFinite(rawOrigin) && rawOrigin > 0 ? rawOrigin : undefined;

  const settlementChain = String(d.settlementChainId ?? "");
  const originChain = String(d.originChainId ?? "") || undefined;
  const confirmed =
    String(d.status ?? "").toUpperCase() === "COMPLETED" || b.event === "deposit.completed";

  if (!externalId) {
    throw new Error("Invalid Dextopus payload: requestId is required.");
  }
  // Both halves of the settlement pair, or nothing. Crediting an amount whose
  // symbol we aren't certain of loses money in one direction or the other.
  if (!asset || !Number.isFinite(amount) || !(amount > 0)) {
    throw new Error(
      `Invalid Dextopus payload for ${externalId}: settlementAsset and a positive ` +
        `settlementAmountFormatted are both required. Got settlementAsset=` +
        `${JSON.stringify(d.settlementAsset)} settlementAmountFormatted=` +
        `${JSON.stringify(d.settlementAmountFormatted)}. Refusing to credit rather than guess.`,
    );
  }

  return {
    externalId,
    address: String(d.depositAddress ?? ""),
    asset,
    // The chain the funds settled on; the origin chain is carried separately.
    chain: settlementChain || originChain || "",
    amount,
    status: confirmed ? "confirmed" : "pending",
    provider: "dextopus",
    originAsset,
    originAmount,
    originChain,
    userId: d.userId ? String(d.userId) : undefined,
    txHash: String(d.originTxHash ?? d.settlementTxHash ?? "") || undefined,
    chainId: Number(d.originChainId ?? d.settlementChainId) || undefined,
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
