import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized, ApiError } from "@/lib/api";
import { getAppState } from "@/lib/serialize";
import { convert } from "@/lib/prices";
import { adjust, balanceOf } from "@/lib/wallet";

const schema = z.object({
  action: z.enum(["fund", "freeze", "unfreeze"]),
  symbol: z.string().optional(), // funding source for "fund"
  amountUsd: z.number().positive().optional(),
});

export async function POST(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const card = await prisma.card.findUnique({ where: { userId } });
    if (!card) throw new ApiError("No card found", 404);

    const { action, symbol, amountUsd } = schema.parse(await req.json());

    if (action === "freeze" || action === "unfreeze") {
      await prisma.card.update({ where: { userId }, data: { frozen: action === "freeze" } });
      const state = await getAppState(userId);
      return ok({ ...state, receipt: { kind: "card", action } });
    }

    // fund from crypto
    const src = symbol ?? "USDT";
    if (!amountUsd) throw new ApiError("Enter an amount", 400);
    const cost = await convert(amountUsd, "USD", src);
    const bal = await balanceOf(userId, src);
    if (bal + 1e-12 < cost) throw new ApiError(`Not enough ${src} to fund the card`, 400);

    await prisma.$transaction(async (tx) => {
      await adjust(tx, userId, src, -cost);
      await tx.card.update({ where: { userId }, data: { balanceUsd: { increment: amountUsd } } });
      await tx.transaction.create({
        data: {
          userId,
          type: "card_fund",
          assetIn: src,
          amountIn: new Prisma.Decimal(cost),
          assetOut: "USD",
          amountOut: new Prisma.Decimal(amountUsd),
          counterparty: "Virtual card ••" + card.last4,
          note: "Card top-up from crypto",
          emoji: "💳",
        },
      });
    });

    const state = await getAppState(userId);
    return ok({ ...state, receipt: { kind: "card", action: "fund", amountUsd, symbol: src, cost } });
  });
}
