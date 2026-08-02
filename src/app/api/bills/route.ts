import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized, ApiError } from "@/lib/api";
import { getAppState } from "@/lib/serialize";
import { convert } from "@/lib/prices";
import { adjust, balanceOf } from "@/lib/wallet";
import { BILL_CATEGORIES } from "@/lib/constants";
import { demoEnabled } from "@/lib/settlement";

const schema = z.object({
  category: z.string(),
  provider: z.string(),
  account: z.string().min(3, "Enter the account / phone number"),
  fiat: z.string().default("NGN"),
  fiatAmount: z.number().positive("Enter an amount"),
  fundingSymbol: z.string().default("USDT"),
});

export async function POST(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();

    // No bill-payment (VTU) provider is wired yet, so this only runs in demo.
    // Fail closed in live so crypto is never taken for a bill we can't deliver.
    if (!demoEnabled()) throw new ApiError("Bill payments are coming soon.", 503);

    const input = schema.parse(await req.json());
    const cat = BILL_CATEGORIES.find((c) => c.id === input.category);
    if (!cat) throw new ApiError("Unknown bill category", 400);

    const cost = await convert(input.fiatAmount, input.fiat, input.fundingSymbol);
    const bal = await balanceOf(userId, input.fundingSymbol);
    if (bal + 1e-12 < cost) throw new ApiError(`Not enough ${input.fundingSymbol} to pay this bill`, 400);

    await prisma.$transaction(async (tx) => {
      await adjust(tx, userId, input.fundingSymbol, -cost);
      await tx.transaction.create({
        data: {
          userId,
          type: "bill",
          assetIn: input.fundingSymbol,
          amountIn: new Prisma.Decimal(cost),
          assetOut: input.fiat,
          amountOut: new Prisma.Decimal(input.fiatAmount),
          counterparty: `${input.provider} · ${input.account}`,
          note: `${cat.title} — ${input.provider}`,
          emoji: cat.icon,
        },
      });
      await tx.user.update({ where: { id: userId }, data: { points: { increment: 20 } } });
    });

    const state = await getAppState(userId);
    return ok({
      ...state,
      receipt: {
        kind: "bill",
        category: cat.title,
        provider: input.provider,
        account: input.account,
        fiat: input.fiat,
        fiatAmount: input.fiatAmount,
        funding: input.fundingSymbol,
        cost,
      },
    });
  });
}
