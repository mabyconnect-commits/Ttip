import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized, ApiError } from "@/lib/api";
import { getAppState } from "@/lib/serialize";
import { adjust } from "@/lib/wallet";
import { cashbackMinClaim } from "@/lib/cashback";

/**
 * Claim accrued cashback into the spendable balance. Only allowed once the
 * cashback balance reaches the threshold; the whole balance is claimed at once.
 */
export async function POST() {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return unauthorized();

    const cashback = Number(user.cashback);
    const min = cashbackMinClaim();
    if (cashback < min) {
      throw new ApiError(`You can claim once your cashback reaches ${min.toLocaleString()}.`, 400);
    }

    const fiat = user.defaultFiat;
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { cashback: 0 } });
      await adjust(tx, userId, fiat, cashback);
      await tx.transaction.create({
        data: {
          userId,
          type: "cashback",
          status: "completed",
          assetOut: fiat,
          amountOut: new Prisma.Decimal(cashback),
          counterparty: "Ttip rewards",
          note: "Cashback claimed",
          emoji: "🎁",
        },
      });
    });

    const state = await getAppState(userId);
    return ok({ ...state, receipt: { kind: "cashback", amount: cashback, fiat } });
  });
}
