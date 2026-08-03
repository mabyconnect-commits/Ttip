import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized, ApiError } from "@/lib/api";
import { getAppState } from "@/lib/serialize";
import { kindOf } from "@/lib/wallet";

/**
 * Move the user's claimable referral earnings (user.referralEarned) into their
 * spendable balance. Atomic + idempotent-by-nature: the pot is zeroed in the
 * same transaction that credits the balance, so a double tap can't double pay.
 */
export async function POST() {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();

    await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { referralEarned: true, defaultFiat: true } });
      if (!user) throw new ApiError("Account not found", 404);
      const amount = Number(user.referralEarned);
      if (!(amount > 0)) throw new ApiError("No referral earnings to withdraw yet.", 400);

      const fiat = user.defaultFiat || "NGN";
      await tx.user.update({ where: { id: userId }, data: { referralEarned: 0 } });
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
