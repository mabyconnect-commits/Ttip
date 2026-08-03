import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized, ApiError } from "@/lib/api";
import { getAppState } from "@/lib/serialize";
import { kindOf } from "@/lib/wallet";
import { rewardsRate, REWARDS_BASE_FIAT } from "@/lib/rewards";

/**
 * Move the user's claimable referral earnings (user.referralEarned) into their
 * spendable balance. Atomic + idempotent-by-nature: the pot is decremented in the
 * same transaction that credits the balance, so a double tap can't double pay.
 *
 * The pot is denominated in REWARDS_BASE_FIAT, so it is converted at the live
 * rate into whatever fiat the user is on. Crediting the raw number instead would
 * simply re-label the pot when the user switched currency — paying out many times
 * its real value, straight from the treasury.
 */
export async function POST() {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { defaultFiat: true } });
    if (!user) throw new ApiError("Account not found", 404);

    const fiat = user.defaultFiat || REWARDS_BASE_FIAT;
    // Resolve the rate before opening the transaction (it may hit the FX feed).
    const rate = await rewardsRate(fiat);
    if (!(rate > 0)) {
      throw new ApiError("Exchange rates are unavailable right now — try again in a moment.", 503);
    }

    await prisma.$transaction(async (tx) => {
      const fresh = await tx.user.findUnique({ where: { id: userId }, select: { referralEarned: true } });
      const base = Number(fresh?.referralEarned ?? 0);
      if (!(base > 0)) throw new ApiError("No referral earnings to withdraw yet.", 400);

      const amount = base * rate;
      if (!(amount > 0) || !Number.isFinite(amount)) {
        throw new ApiError("Couldn't value your earnings right now — try again in a moment.", 503);
      }

      // Decrement exactly what we credit, so earnings accrued mid-withdrawal
      // aren't silently wiped.
      await tx.user.update({ where: { id: userId }, data: { referralEarned: { decrement: base } } });
      await tx.balance.upsert({
        where: { userId_symbol: { userId, symbol: fiat } },
        create: { userId, symbol: fiat, kind: kindOf(fiat), amount: new Prisma.Decimal(amount) },
        update: { amount: { increment: amount } },
      });
      await tx.transaction.create({
        data: {
          userId,
          type: "referral_withdraw",
          status: "completed",
          assetOut: fiat,
          amountOut: new Prisma.Decimal(amount),
          counterparty: "Ttip rewards",
          note: "Referral earnings to wallet",
          emoji: "👯",
        },
      });
    });

    return ok(await getAppState(userId));
  });
}
