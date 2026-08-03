import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { toUsd } from "./prices";
import { REWARDS_BASE_FIAT, toRewardsBase } from "./rewards";
import { REFERRAL_EARN_PCT, DEPOSIT_BONUS_NGN, DEPOSIT_BONUS_MIN_USD, DEPOSIT_BONUS_HOLD_HOURS } from "./constants";

/**
 * Referral earnings.
 *
 * Two mechanics beyond the one-off signup bonus:
 *   1. A lifetime revenue share — the referrer earns REFERRAL_EARN_PCT of the
 *      platform revenue (fees + spread) on every transaction their referred
 *      users make. The pot is denominated in REWARDS_BASE_FIAT (see
 *      src/lib/rewards.ts), so revenue in any other fiat converts on the way in
 *      and the pot converts on the way out.
 *   2. A first-deposit bonus for the referred user — DEPOSIT_BONUS_NGN, paid
 *      DEPOSIT_BONUS_HOLD_HOURS after their first deposit worth ≥ MIN_USD, only
 *      if they still hold at least that value (they didn't cash straight out).
 */

/**
 * Providers that mean real money actually arrived. The sandbox/simulator is
 * deliberately excluded — the deposit bonus pays real naira, so it must only
 * ever be triggered by a deposit real money backed.
 */
const REAL_FUNDING_PROVIDERS = ["dextopus", "flutterwave", "paystack", "monnify", "coralpay"] as const;

export function referralEarnPct(): number {
  const v = Number(process.env.REFERRAL_EARN_PCT);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : REFERRAL_EARN_PCT;
}

type Tx = Prisma.TransactionClient;

/**
 * Credit a referrer their share of the platform revenue a referred user just
 * generated. No-op when the user has no referrer or the revenue is ≤ 0. Runs
 * inside the caller's transaction so the earning is atomic with the trade.
 */
export async function accrueReferralEarning(
  tx: Tx,
  downlineUserId: string,
  revenueFiat: number,
  ctx: { fiat: string; source: string },
): Promise<void> {
  if (!(revenueFiat > 0)) return;
  const downline = await tx.user.findUnique({ where: { id: downlineUserId }, select: { referredById: true, name: true } });
  if (!downline?.referredById) return;

  // Normalise into the pot's base currency before it lands, so a pot built from
  // mixed-currency revenue still adds up to one honest number.
  const earn = (await toRewardsBase(revenueFiat, ctx.fiat)) * referralEarnPct();
  if (!(earn > 0) || !Number.isFinite(earn)) return;
  const referrerId = downline.referredById;

  // Earnings accrue to a claimable referral pot (user.referralEarned). The user
  // moves it to their spendable balance via "Withdraw to wallet" (/api/referrals
  // /withdraw); a permanent referral_bonus transaction records the earning for
  // history and the all-time leaderboard.
  await tx.user.update({ where: { id: referrerId }, data: { referralEarned: { increment: earn } } });
  await tx.transaction.create({
    data: {
      userId: referrerId,
      type: "referral_bonus",
      status: "completed",
      assetOut: REWARDS_BASE_FIAT,
      amountOut: new Prisma.Decimal(earn),
      counterparty: downline.name,
      note: `Referral earning · ${ctx.source}`,
      emoji: "👯",
    },
  });
}

/** How long the qualifying deposit must stay on Ttip, in hours. */
export function depositBonusHoldHours(): number {
  const h = Number(process.env.DEPOSIT_BONUS_HOLD_HOURS);
  return Number.isFinite(h) && h > 0 ? h : DEPOSIT_BONUS_HOLD_HOURS;
}

function holdMs(): number {
  return depositBonusHoldHours() * 3600_000;
}
function minUsd(): number {
  const v = Number(process.env.DEPOSIT_BONUS_MIN_USD);
  return Number.isFinite(v) && v > 0 ? v : DEPOSIT_BONUS_MIN_USD;
}
function bonusNgn(): number {
  const v = Number(process.env.DEPOSIT_BONUS_NGN);
  return Number.isFinite(v) && v > 0 ? v : DEPOSIT_BONUS_NGN;
}

/**
 * Pay the first-deposit bonus if the user has now earned it. Safe to call on
 * every app load: it short-circuits cheaply for anyone who already got it, isn't
 * referred, or has no qualifying deposit, and is idempotent (a single
 * `deposit_bonus` transaction is the marker). Never throws — a failure here must
 * not break app load.
 */
export async function maybePayDepositBonus(userId: string): Promise<void> {
  try {
    // Gate: referred users only, once ever.
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { referredById: true } });
    if (!user?.referredById) return;
    if (await prisma.transaction.count({ where: { userId, type: "deposit_bonus" } })) return;

    // First deposit worth ≥ MIN_USD that REAL money actually backed. Read from
    // settlements, not transactions: the deposit simulator also writes a
    // "deposit" transaction, so counting those would pay a real ₦ bonus for
    // funds nobody ever sent.
    const deposits = await prisma.settlement.findMany({
      where: {
        userId,
        status: "completed",
        kind: { in: ["deposit", "buy"] },
        provider: { in: [...REAL_FUNDING_PROVIDERS] },
      },
      orderBy: { createdAt: "asc" },
      select: { asset: true, amount: true, createdAt: true },
    });
    if (!deposits.length) return;

    const threshold = minUsd();
    let qualifiedAt: Date | null = null;
    for (const d of deposits) {
      const usd = await toUsd(Number(d.amount), d.asset);
      if (usd >= threshold) { qualifiedAt = d.createdAt; break; }
    }
    if (!qualifiedAt) return;

    // Must be at least HOLD hours since that deposit…
    if (Date.now() - qualifiedAt.getTime() < holdMs()) return;

    // …and they must still hold at least that value (didn't cash straight out).
    const balances = await prisma.balance.findMany({ where: { userId }, select: { symbol: true, amount: true } });
    let totalUsd = 0;
    for (const b of balances) totalUsd += await toUsd(Number(b.amount), b.symbol);
    if (totalUsd < threshold) return;

    const amount = bonusNgn();
    await prisma.$transaction(async (tx) => {
      // Re-check inside the transaction to close the idempotency race.
      if (await tx.transaction.count({ where: { userId, type: "deposit_bonus" } })) return;
      await tx.balance.upsert({
        where: { userId_symbol: { userId, symbol: "NGN" } },
        create: { userId, symbol: "NGN", kind: "fiat", amount: new Prisma.Decimal(amount) },
        update: { amount: { increment: amount } },
      });
      await tx.transaction.create({
        data: {
          userId,
          type: "deposit_bonus",
          status: "completed",
          assetOut: "NGN",
          amountOut: new Prisma.Decimal(amount),
          counterparty: "Ttip rewards",
          note: "First deposit bonus",
          emoji: "🎁",
        },
      });
    });
  } catch {
    /* never break app load on a rewards hiccup */
  }
}
