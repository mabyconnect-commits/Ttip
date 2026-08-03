import "server-only";
import { Prisma } from "@prisma/client";
import { convert } from "./prices";
import { CASHBACK_PCT, CASHBACK_MIN_CLAIM } from "./constants";

/**
 * Cashback: users earn a slice of every buy/sell into a separate cashback
 * balance, claimable to their spendable balance once it reaches the threshold.
 * A sweet, sticky loyalty hook — the more you trade, the more you earn back.
 *
 * The pot (`user.cashback`) is a bare number with no currency attached, so it is
 * denominated in ONE fixed currency — `CASHBACK_BASE_FIAT` — regardless of what
 * the user is currently displaying. Everything crossing that boundary converts:
 * accruals convert the trade's fiat volume *into* the base, and a claim converts
 * the pot *out* of the base at the live rate. Without that, switching the display
 * currency would silently re-denominate the pot (₦6,908 claimed as R6,908 ≈
 * ₦570,833) and drain the treasury.
 */

/** The currency `user.cashback` is stored in. Do not change without a data migration. */
export const CASHBACK_BASE_FIAT = "NGN";

export function cashbackPct(): number {
  const v = Number(process.env.CASHBACK_PCT);
  return Number.isFinite(v) && v >= 0 && v < 0.1 ? v : CASHBACK_PCT;
}

/** Minimum claimable pot, in `CASHBACK_BASE_FIAT`. */
export function cashbackMinClaim(): number {
  const v = Number(process.env.CASHBACK_MIN_CLAIM);
  return Number.isFinite(v) && v > 0 ? v : CASHBACK_MIN_CLAIM;
}

/** Live value of one unit of the base fiat in `fiat` (1 when it's the base). */
export async function cashbackRate(fiat: string): Promise<number> {
  if (!fiat || fiat === CASHBACK_BASE_FIAT) return 1;
  const rate = await convert(1, CASHBACK_BASE_FIAT, fiat);
  // A broken/zero FX read must never mint value — fall back to no conversion
  // rather than crediting a wrong number.
  return Number.isFinite(rate) && rate > 0 ? rate : 0;
}

/**
 * Accrue cashback on a completed trade, inside an existing transaction. Pass the
 * fiat volume of the trade in `ctx.fiat`; it is converted into the base currency
 * before hitting the pot, so a pot built from mixed-currency trades still adds up.
 * The user earns `cashbackPct()` of it and a `cashback_earn` record is written for
 * the history, both in `CASHBACK_BASE_FIAT`. No-op for zero/negative volume.
 */
export async function accrueCashback(
  tx: Prisma.TransactionClient,
  userId: string,
  fiatVolume: number,
  ctx: { fiat: string; source: string },
): Promise<void> {
  if (!(fiatVolume > 0)) return;
  const volumeBase =
    ctx.fiat === CASHBACK_BASE_FIAT ? fiatVolume : await convert(fiatVolume, ctx.fiat, CASHBACK_BASE_FIAT);
  const amount = volumeBase * cashbackPct();
  if (!(amount > 0) || !Number.isFinite(amount)) return;
  await tx.user.update({ where: { id: userId }, data: { cashback: { increment: amount } } });
  await tx.transaction.create({
    data: {
      userId,
      type: "cashback_earn",
      status: "completed",
      assetOut: CASHBACK_BASE_FIAT,
      amountOut: new Prisma.Decimal(amount),
      counterparty: "Ttip rewards",
      note: `Cashback from ${ctx.source}`,
      emoji: "🎁",
    },
  });
}
