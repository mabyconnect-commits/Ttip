import crypto from "crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized, ApiError } from "@/lib/api";
import { getAppState } from "@/lib/serialize";
import { adjust } from "@/lib/wallet";
import { convert } from "@/lib/prices";
import { planFunding, type FundingSource } from "@/lib/funding-plan";
import { sellValue } from "@/lib/spendable";
import { requireWithdrawPin } from "@/lib/withdraw-pin";
import { giftCardProvider, giftCardPrice, type GiftCardOrderResult } from "@/lib/settlement/giftcard";
import { deliverOrder, refundOrder } from "@/lib/settlement/giftcard-order";
import { accrueCashback } from "@/lib/cashback";
import { COMPANY } from "@/lib/company";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

/**
 * Buying a gift card.
 *
 * The same money shape as every other outbound path here, for the same reason:
 * the user is debited and a pending order written in ONE atomic step, then the
 * provider is asked, and a definite failure refunds every funding leg. Money
 * cannot leave a wallet without a row to match it, and a card that never
 * arrives never leaves someone out of pocket.
 *
 * Funded from EVERY wallet, like a bank payout — someone holding USDT and a bit
 * of SOL can buy a $25 card without swapping to naira first.
 *
 * The one difference from a payout: an ambiguous provider response is held as
 * PENDING, never failed. A gift card order that may have been placed must not
 * be refunded, or we hand back the money and the card both.
 */

const schema = z.object({
  productId: z.string().min(1),
  brand: z.string().min(1).max(120),
  country: z.string().min(2).max(3),
  faceValue: z.number().positive(),
  faceCurrency: z.string().min(3).max(4),
  pin: z.string().optional(),
  idempotencyKey: z.string().regex(/^[a-zA-Z0-9-]{8,64}$/).optional(),
});

export async function POST(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return unauthorized();

    const input = schema.parse(await req.json());

    // A gift card code is irreversible the moment it's shown — the same test a
    // bank payout meets, so the same PIN.
    await requireWithdrawPin(userId, input.pin);

    const provider = giftCardProvider();
    const fiat = user.defaultFiat;

    // Price it from the provider's own catalogue, never from what the client
    // sent. A client that can name its own price can buy a $100 card for ₦1.
    const products = await provider.products(input.country.toUpperCase());
    const product = products.find((p) => p.id === input.productId);
    if (!product) throw new ApiError("That card isn't available right now.", 400);
    if (product.denominations.length && !product.denominations.includes(input.faceValue)) {
      throw new ApiError(`${product.brand} doesn't sell a ${input.faceValue} card.`, 400);
    }

    const priceInCardCurrency = giftCardPrice(input.faceValue, product.costRate);
    const costFiat = await convert(priceInCardCurrency, product.currency, fiat).catch(() => 0);
    if (!(costFiat > 0)) throw new ApiError("Rate unavailable, try again in a moment.", 503);

    // What we actually keep: the charge minus what the distributor bills us.
    // Recorded now, at the rate that applied, so the revenue report never has to
    // re-derive it from a discount that may have changed since.
    const marginFiat = (costFiat * (priceInCardCurrency - input.faceValue * product.costRate)) / priceInCardCurrency;

    // Which wallets pay. Same planner as a bank send, so "can I afford it" has
    // one answer across the app.
    const balances = await prisma.balance.findMany({ where: { userId } });
    const sources: FundingSource[] = [];
    for (const b of balances) {
      const held = Number(b.amount);
      if (!(held > 0)) continue;
      const unit = await sellValue(1, b.symbol, fiat);
      if (unit > 0) sources.push({ symbol: b.symbol, amount: held, fiatPerUnit: unit });
    }
    const plan = planFunding(costFiat, sources);
    if (!plan.ok) {
      throw new ApiError(
        `Not enough across your wallets — you're ${fiat} ${Math.ceil(plan.short).toLocaleString("en-US")} short.`,
        400,
      );
    }

    const reference = "gc_" + (input.idempotencyKey ?? crypto.randomUUID());

    // 1. Debit + pending order, atomically. The unique reference means a second
    //    tap on the same attempt hits the constraint and rolls back rather than
    //    buying a second card.
    try {
      await prisma.$transaction(async (tx) => {
        for (const leg of plan.legs) await adjust(tx, userId, leg.symbol, -leg.take);
        const first = plan.legs[0];
        await tx.giftCardOrder.create({
          data: {
            userId,
            productId: product.id,
            brand: product.brand,
            country: product.country,
            faceValue: new Prisma.Decimal(input.faceValue),
            faceCurrency: product.currency,
            costFiat: new Prisma.Decimal(costFiat),
            fiat,
            status: "pending",
            provider: provider.name,
            reference,
          },
        });
        await tx.transaction.create({
          data: {
            userId,
            type: "giftcard",
            status: "pending",
            assetIn: first?.symbol ?? fiat,
            amountIn: new Prisma.Decimal(first?.take ?? 0),
            assetOut: product.currency,
            amountOut: new Prisma.Decimal(input.faceValue),
            counterparty: product.brand,
            note: `${product.brand} ${product.currency} ${input.faceValue} gift card`,
            emoji: "🎁",
            meta: {
              reference,
              provider: provider.name,
              costFiat,
              fee: marginFiat > 0 ? marginFiat : 0,
              feeCurrency: fiat,
              fiat,
              legs: plan.legs.map((l) => ({ symbol: l.symbol, take: l.take, fiat: l.fiat })),
            },
          },
        });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ApiError("That purchase is already going through — check your cards in a moment.", 409);
      }
      throw e;
    }

    // 2. Buy it.
    const result = await provider
      .order({
        productId: product.id,
        unitPrice: input.faceValue,
        reference,
        recipientEmail: user.email,
        senderName: COMPANY.product,
      })
      .catch((e): GiftCardOrderResult => {
        // Never a failure on a throw: the order may have been placed, and
        // refunding would hand back the money AND the card.
        console.error("[giftcard] order threw", reference, e);
        return { ok: true, pending: true, message: (e as Error).message };
      });

    if (!result.ok) {
      await refundOrder(reference, result.message ?? "The provider refused that purchase.");
      throw new ApiError(`${result.message ?? "That didn't go through"} — your balance was not charged.`, 400);
    }

    if (result.code) {
      await deliverOrder(reference, result.providerRef, result.code, result.pin);
      // Cashback on the naira volume, same as a buy.
      await prisma
        .$transaction(async (tx) => {
          await accrueCashback(tx, userId, costFiat, { fiat, source: "giftcard" });
        })
        .catch(() => {
          /* a rewards accrual must never fail a card that already arrived */
        });
    } else {
      await prisma.giftCardOrder.updateMany({
        where: { reference },
        data: { providerRef: result.providerRef ?? null, error: result.message ?? null },
      });
    }

    const state = await getAppState(userId);
    return ok({
      ...state,
      order: {
        reference,
        brand: product.brand,
        faceValue: input.faceValue,
        faceCurrency: product.currency,
        costFiat,
        fiat,
        status: result.code ? "delivered" : "pending",
        message: result.code
          ? undefined
          : "Your card is on its way — it usually lands within a minute. We'll have it under Gift cards.",
      },
    });
  });
}
