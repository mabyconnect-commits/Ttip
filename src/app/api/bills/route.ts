import crypto from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized, ApiError } from "@/lib/api";
import { getAppState } from "@/lib/serialize";
import { convert } from "@/lib/prices";
import { balanceOf } from "@/lib/wallet";
import { BILL_CATEGORIES } from "@/lib/constants";
import { payBill, ensureFloat, debitFloat, settlementEnabled } from "@/lib/settlement";

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

    // Fail closed: bills move real money — refuse unless live (Flutterwave) or
    // demo (sandbox). Anything else and we never take crypto for a bill.
    if (!settlementEnabled()) throw new ApiError("Bill payments aren't available yet. Please check back soon.", 503);

    const input = schema.parse(await req.json());
    const cat = BILL_CATEGORIES.find((c) => c.id === input.category);
    if (!cat) throw new ApiError("Unknown bill category", 400);
    if (!(cat.providers as readonly string[]).includes(input.provider)) throw new ApiError("Unknown provider for this bill", 400);

    // Crypto to debit = market value of the bill's face amount (matches the
    // "Pays from" figure shown to the user; no hidden markup).
    const cost = await convert(input.fiatAmount, input.fiat, input.fundingSymbol);
    const bal = await balanceOf(userId, input.fundingSymbol);
    if (bal + 1e-12 < cost) throw new ApiError(`Not enough ${input.fundingSymbol} to pay this bill`, 400);

    const reference = "bill_" + crypto.randomUUID();

    // Make sure the fiat float can cover the biller payment; if short, auto-sell
    // treasury crypto into the float so the bill still goes out now.
    await ensureFloat(input.fiat, input.fiatAmount);

    // Atomic debit + pending settlement, then deliver the bill. Throws (balance
    // refunded) on failure; returns "completed" (instant biller / sandbox) or
    // "pending" (awaiting the provider webhook).
    const outcome = await payBill({
      userId,
      category: cat.id,
      categoryTitle: cat.title,
      categoryEmoji: cat.icon,
      provider: input.provider,
      customer: input.account,
      fundingSymbol: input.fundingSymbol,
      cost,
      amountFiat: input.fiatAmount,
      currency: input.fiat,
      reference,
    });

    // Draw the fiat down from the float once delivered, and reward points.
    if (outcome.status === "completed") {
      await prisma.$transaction(async (tx) => {
        await debitFloat(tx, input.fiat, input.fiatAmount);
        await tx.user.update({ where: { id: userId }, data: { points: { increment: 20 } } });
      });
    } else {
      await prisma.user.update({ where: { id: userId }, data: { points: { increment: 20 } } });
    }

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
        status: outcome.status, // "completed" (instant) or "pending" (processing)
      },
    });
  });
}
