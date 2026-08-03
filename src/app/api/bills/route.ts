import crypto from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized, ApiError } from "@/lib/api";
import { getAppState } from "@/lib/serialize";
import { convert } from "@/lib/prices";
import { billFee } from "@/lib/fees";
import { balanceOf } from "@/lib/wallet";
import { BILL_CATEGORIES, BILL_FIAT } from "@/lib/constants";
import { payBill, ensureFloat, settlementEnabled, findBillItem } from "@/lib/settlement";

const schema = z.object({
  category: z.string(),
  provider: z.string(),
  billerCode: z.string().min(2, "Choose a plan"),
  itemCode: z.string().min(2, "Choose a plan"),
  account: z.string().min(3, "Enter the account / phone number"),
  // For fixed-price plans the server uses the plan's price; for variable plans
  // (airtime, prepaid meters) the user supplies the amount.
  fiatAmount: z.number().positive("Enter an amount").optional(),
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

    // Resolve the chosen plan from the catalog and trust its price/label — never
    // the client — for fixed plans, so the amount can't be tampered with.
    const found = await findBillItem(input.billerCode, input.itemCode);
    if (!found || found.category !== input.category) throw new ApiError("Choose a valid plan for this bill", 400);
    const item = found.item;

    const amountFiat = item.variableAmount ? input.fiatAmount ?? 0 : item.amount;
    if (!(amountFiat > 0)) throw new ApiError("Enter an amount", 400);

    // The catalog's plan prices and the biller itself are naira-denominated, so a
    // bill is always priced in BILL_FIAT. Taking the user's display currency here
    // would charge a ZAR user R100 for a ₦100 recharge — ~82x the real price.
    const fiat = BILL_FIAT;

    // Crypto to debit = market value of the bill's face amount PLUS our service
    // fee. The biller still receives exactly `amountFiat`; the fee is ours, and
    // it's shown on the bills screen before the user confirms. Bills previously
    // ran at exactly zero margin while still costing us the provider and the
    // float — work done for nothing on every recharge.
    const serviceFee = billFee(amountFiat);
    const cost = await convert(amountFiat + serviceFee, fiat, input.fundingSymbol);
    const bal = await balanceOf(userId, input.fundingSymbol);
    if (bal + 1e-12 < cost) throw new ApiError(`Not enough ${input.fundingSymbol} to pay this bill`, 400);

    const reference = "bill_" + crypto.randomUUID();

    // Make sure the fiat float can cover the biller payment; if short, auto-sell
    // treasury crypto into the float so the bill still goes out now.
    await ensureFloat(fiat, amountFiat);

    // Atomic debit + pending settlement, then deliver the bill. Throws (balance
    // refunded) on failure; returns "completed" (instant biller / sandbox) or
    // "pending" (awaiting the provider webhook).
    let outcome;
    try {
      outcome = await payBill({
        userId,
        category: cat.id,
        categoryTitle: cat.title,
        categoryEmoji: cat.icon,
        provider: input.provider,
        billerCode: input.billerCode,
        itemCode: input.itemCode,
        customer: input.account,
        fundingSymbol: input.fundingSymbol,
        cost,
        amountFiat,
        serviceFee,
        currency: fiat,
        reference,
      });
    } catch (e: any) {
      // payBill refunds the debited crypto on failure. Surface the provider's
      // real reason (e.g. biller not enabled) instead of a generic 500 — the
      // balance was not charged.
      const base = (e?.message || "Bill payment could not be completed").trim();
      throw new ApiError(`${base} — balance not charged.`, 502);
    }

    // The float draw-down lives in finalizeBill, so it happens exactly once
    // whether the bill settled instantly or later via webhook/reconcile.
    await prisma.user.update({ where: { id: userId }, data: { points: { increment: 20 } } });

    const state = await getAppState(userId);
    return ok({
      ...state,
      receipt: {
        kind: "bill",
        category: cat.title,
        provider: input.provider,
        plan: item.name,
        account: input.account,
        fiat,
        fiatAmount: amountFiat,
        serviceFee,
        funding: input.fundingSymbol,
        cost,
        status: outcome.status, // "completed" (instant) or "pending" (processing)
        reference, // shown on the receipt and quoted to support when tracing
      },
    });
  });
}
