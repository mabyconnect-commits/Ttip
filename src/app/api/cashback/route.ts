import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized, ApiError } from "@/lib/api";
import { getAppState } from "@/lib/serialize";
import { adjust } from "@/lib/wallet";
import { cashbackMinClaim, cashbackRate, CASHBACK_BASE_FIAT } from "@/lib/cashback";

/**
 * Claim accrued cashback into the spendable balance. Only allowed once the
 * cashback balance reaches the threshold; the whole balance is claimed at once.
 *
 * The pot is denominated in CASHBACK_BASE_FIAT, so it is converted at the live
 * rate into whatever fiat the user is on — a ₦6,908 pot claimed while on ZAR
 * credits the rand value of ₦6,908 (about R84), never R6,908.
 */
export async function POST() {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return unauthorized();

    const min = cashbackMinClaim();
    if (Number(user.cashback) < min) {
      throw new ApiError(`You can claim once your cashback reaches ${min.toLocaleString()}.`, 400);
    }

    const fiat = user.defaultFiat || CASHBACK_BASE_FIAT;
    // Resolve the rate before opening the transaction (it may hit the FX feed).
    const rate = await cashbackRate(fiat);
    if (!(rate > 0)) {
      throw new ApiError("Exchange rates are unavailable right now — try again in a moment.", 503);
    }

    const claimed = await prisma.$transaction(async (tx) => {
      // Re-read the pot inside the transaction and decrement exactly what we
      // credit, so a double tap can't pay twice and a concurrent accrual isn't lost.
      const fresh = await tx.user.findUnique({ where: { id: userId }, select: { cashback: true } });
      const base = Number(fresh?.cashback ?? 0);
      if (base < min) {
        throw new ApiError(`You can claim once your cashback reaches ${min.toLocaleString()}.`, 400);
      }
      const amount = base * rate;
      if (!(amount > 0) || !Number.isFinite(amount)) {
        throw new ApiError("Couldn't value your cashback right now — try again in a moment.", 503);
      }

      await tx.user.update({ where: { id: userId }, data: { cashback: { decrement: base } } });
      await adjust(tx, userId, fiat, amount);
      await tx.transaction.create({
        data: {
          userId,
          type: "cashback",
          status: "completed",
          assetOut: fiat,
          amountOut: new Prisma.Decimal(amount),
          counterparty: "Ttip rewards",
          note: "Cashback claimed",
          emoji: "🎁",
        },
      });
      return amount;
    });

    const state = await getAppState(userId);
    return ok({ ...state, receipt: { kind: "cashback", amount: claimed, fiat } });
  });
}
