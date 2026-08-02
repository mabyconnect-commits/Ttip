import "server-only";
import { Prisma } from "@prisma/client";
import { CASHBACK_PCT, CASHBACK_MIN_CLAIM } from "./constants";

/**
 * Cashback: users earn a slice of every buy/sell into a separate cashback
 * balance, claimable to their spendable balance once it reaches the threshold.
 * A sweet, sticky loyalty hook — the more you trade, the more you earn back.
 */

export function cashbackPct(): number {
  const v = Number(process.env.CASHBACK_PCT);
  return Number.isFinite(v) && v >= 0 && v < 0.1 ? v : CASHBACK_PCT;
}

export function cashbackMinClaim(): number {
  const v = Number(process.env.CASHBACK_MIN_CLAIM);
  return Number.isFinite(v) && v > 0 ? v : CASHBACK_MIN_CLAIM;
}

/**
 * Accrue cashback on a completed trade, inside an existing transaction. Pass the
 * fiat volume of the trade (naira bought or sold); the user earns `cashbackPct()`
 * of it. No-op for zero/negative volume.
 */
export async function accrueCashback(tx: Prisma.TransactionClient, userId: string, fiatVolume: number): Promise<void> {
  const amount = fiatVolume * cashbackPct();
  if (!(amount > 0)) return;
  await tx.user.update({ where: { id: userId }, data: { cashback: { increment: amount } } });
}
