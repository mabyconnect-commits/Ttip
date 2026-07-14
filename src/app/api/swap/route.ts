import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized, ApiError } from "@/lib/api";
import { getAppState } from "@/lib/serialize";
import { convert, isCrypto } from "@/lib/prices";
import { adjust, balanceOf } from "@/lib/wallet";
import { SWAP_FEE_PCT } from "@/lib/constants";

const schema = z.object({
  fromSymbol: z.string(),
  toSymbol: z.string(),
  amount: z.number().positive("Enter an amount"), // always the "from" amount
  payoutToBank: z.boolean().optional(),
});

export async function POST(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();

    const { fromSymbol, toSymbol, amount, payoutToBank } = schema.parse(await req.json());
    if (fromSymbol === toSymbol) throw new ApiError("Pick two different assets", 400);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return unauthorized();

    const bal = await balanceOf(userId, fromSymbol);
    if (bal + 1e-12 < amount) throw new ApiError(`Insufficient ${fromSymbol} balance`, 400);

    // gross output before fee
    const gross = await convert(amount, fromSymbol, toSymbol);
    const free = user.freeSwapsLeft > 0;
    const feePct = free ? 0 : SWAP_FEE_PCT;
    const net = gross * (1 - feePct);
    const rate = amount > 0 ? net / amount : 0;

    const result = await prisma.$transaction(async (tx) => {
      await adjust(tx, userId, fromSymbol, -amount);

      // If swapping crypto -> fiat with bank payout, the fiat leaves the wallet.
      const settledToBank = payoutToBank && !isCrypto(toSymbol);
      if (!settledToBank) {
        await adjust(tx, userId, toSymbol, net);
      }

      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          freeSwapsLeft: free ? { decrement: 1 } : undefined,
          points: { increment: 60 },
        },
      });

      const txn = await tx.transaction.create({
        data: {
          userId,
          type: "swap",
          assetIn: fromSymbol,
          amountIn: new Prisma.Decimal(amount),
          assetOut: toSymbol,
          amountOut: new Prisma.Decimal(net),
          counterparty: settledToBank ? user.bankAccount : "Ttip wallet",
          note: `Swapped ${fromSymbol} → ${toSymbol}`,
          emoji: "⇄",
          meta: { rate, feePct, settledToBank, free },
        },
      });
      return { updated, txn, settledToBank };
    });

    const state = await getAppState(userId);
    return ok({
      ...state,
      receipt: {
        kind: "swap",
        fromSymbol,
        toSymbol,
        amountIn: amount,
        amountOut: net,
        rate,
        feePct,
        free,
        settledToBank: result.settledToBank,
        destination: result.settledToBank ? user.bankAccount : "Ttip wallet",
        id: result.txn.id,
      },
    });
  });
}
