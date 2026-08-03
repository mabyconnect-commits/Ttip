import "server-only";
import { Prisma } from "@prisma/client";
import { REWARDS_BASE_FIAT, toRewardsBase } from "./rewards";
import { CASHBACK_PCT, CASHBACK_MIN_CLAIM } from "./constants";

/**
 * Cashback: users earn a slice of every buy/sell into a separate cashback
 * balance, claimable to their spendable balance once it reaches the threshold.
 * A sweet, sticky loyalty hook — the more you trade, the more you earn back.
 *
 * The pot (`user.cashback`) is denominated in `REWARDS_BASE_FIAT` — see
 * src/lib/rewards.ts for why every boundary must convert.
 */

export function cashbackPct(): number {
  const v = Number(process.env.CASHBACK_PCT);
  return Number.isFinite(v) && v >= 0 && v < 0.1 ? v : CASHBACK_PCT;
}

/** Minimum claimable pot, in `REWARDS_BASE_FIAT`. */
export function cashbackMinClaim(): number {
  const v = Number(process.env.CASHBACK_MIN_CLAIM);
  return Number.isFinite(v) && v > 0 ? v : CASHBACK_MIN_CLAIM;
}

/**
 * Accrue cashback on a completed trade, inside an existing transaction. Pass the
 * fiat volume of the trade in `ctx.fiat`; it is converted into the base currency
 * before hitting the pot, so a pot built from mixed-currency trades still adds up.
 * The user earns `cashbackPct()` of it and a `cashback_earn` record is written for
 * the history, both in `REWARDS_BASE_FIAT`. No-op for zero/negative volume.
 */
export async function accrueCashback(
  tx: Prisma.TransactionClient,
  userId: string,
  fiatVolume: number,
  ctx: { fiat: string; source: string },
): Promise<void> {
  if (!(fiatVolume > 0)) return;
  const amount = (await toRewardsBase(fiatVolume, ctx.fiat)) * cashbackPct();
  if (!(amount > 0) || !Number.isFinite(amount)) return;
  await tx.user.update({ where: { id: userId }, data: { cashback: { increment: amount } } });
  await tx.transaction.create({
    data: {
      userId,
      type: "cashback_earn",
      status: "completed",
      assetOut: REWARDS_BASE_FIAT,
      amountOut: new Prisma.Decimal(amount),
      counterparty: "Ttip rewards",
      note: `Cashback from ${ctx.source}`,
      emoji: "🎁",
    },
  });
}
