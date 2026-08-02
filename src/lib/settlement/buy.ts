import "server-only";
import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { kindOf } from "../wallet";
import { referenceRate } from "../rate";
import { quoteBuy, collectionFeePct } from "../pricing";
import { adjustTreasury } from "./treasury";
import { accrueCashback } from "../cashback";
import { accrueReferralEarning } from "../referral";
import { initCollection, collectionProvider } from "./collection";

/**
 * Buy-crypto on-ramp: the user pays fiat (card/bank) and receives crypto from
 * treasury at the buy quote (market rate + margin). The fiat is collected first;
 * the crypto is credited only once the charge is confirmed.
 *
 * Ledger safety mirrors the payout path: a pending settlement + pending
 * transaction are written up-front, and the crypto credit happens exactly once
 * (idempotent on the reference) when the collection settles.
 */

export interface BuyRequest {
  userId: string;
  email: string;
  symbol: string; // crypto to buy: USDT, USDC, BTC, …
  fiat: string; // NGN, GHS, …
  fiatAmount: number; // how much fiat the user spends
  callbackUrl?: string;
}

export interface BuyResult {
  reference: string;
  status: "pending" | "completed" | "failed";
  amountAsset: number; // crypto the user receives
  rate: number; // fiat per 1 unit paid by the user
  checkoutUrl?: string; // hosted payment page (live)
  message?: string;
}

export async function createBuyOrder(req: BuyRequest): Promise<BuyResult> {
  if (req.fiatAmount <= 0) throw new Error("Enter an amount");

  // Lock the quote: user pays market + margin per unit.
  const marketRate = await referenceRate(req.symbol, req.fiat);
  if (!(marketRate > 0)) throw new Error("Rate unavailable, try again");
  const q = quoteBuy({ asset: req.symbol, fiat: req.fiat, amountAsset: 1, marketRate });
  const userRate = q.userRate; // fiat per 1 unit incl. margin
  // Credit crypto on the amount NET of the provider's collection fee, so that
  // fee never eats our margin (the user effectively covers it).
  const netFiat = req.fiatAmount * (1 - collectionFeePct());
  const amountAsset = netFiat / userRate;
  // Platform revenue on this buy: what the user pays minus the market cost of the
  // crypto we hand them. Stored so the referrer's share is paid when it settles.
  const spreadFiat = Math.max(0, req.fiatAmount - amountAsset * marketRate);

  const reference = "buy_" + crypto.randomUUID();
  const provider = collectionProvider();

  // 1. Record the pending order atomically before charging anything.
  await prisma.$transaction(async (tx) => {
    await tx.transaction.create({
      data: {
        userId: req.userId,
        type: "buy",
        status: "pending",
        assetIn: req.fiat,
        amountIn: new Prisma.Decimal(req.fiatAmount),
        assetOut: req.symbol,
        amountOut: new Prisma.Decimal(amountAsset),
        counterparty: "Card / bank",
        note: `Bought ${req.symbol} with ${req.fiat}`,
        emoji: "🛒",
        meta: { reference, provider, rate: userRate, marketRate },
      },
    });
    await tx.settlement.create({
      data: {
        userId: req.userId,
        kind: "buy",
        provider,
        externalId: reference,
        reference,
        status: "pending",
        asset: req.symbol,
        amount: new Prisma.Decimal(amountAsset),
        raw: { fiat: req.fiat, fiatAmount: req.fiatAmount, rate: userRate, spreadFiat } as Prisma.InputJsonValue,
      },
    });
  });

  // 2. Start the collection.
  const init = await initCollection({
    userId: req.userId,
    email: req.email,
    amountFiat: req.fiatAmount,
    currency: req.fiat,
    reference,
    callbackUrl: req.callbackUrl,
  });

  if (init.status === "failed") {
    await finalizeBuy({ reference }, "failed");
    return { reference, status: "failed", amountAsset, rate: userRate, message: init.message };
  }

  // 3. Sandbox settles instantly; live waits for the collection webhook.
  if (init.status === "completed") {
    await finalizeBuy({ reference }, "completed");
    return { reference, status: "completed", amountAsset, rate: userRate };
  }

  return { reference, status: "pending", amountAsset, rate: userRate, checkoutUrl: init.checkoutUrl };
}

/**
 * Finalize a buy when the collection confirms. On success credits the user's
 * crypto and draws it from treasury; on failure marks it failed (no fiat was
 * debited from the wallet — the charge simply didn't complete). Idempotent.
 */
export async function finalizeBuy(
  match: { externalId?: string; reference?: string },
  status: "completed" | "failed",
): Promise<{ updated: boolean; credited?: boolean }> {
  const ors: { externalId?: string; reference?: string }[] = [];
  if (match.reference) ors.push({ reference: match.reference });
  if (match.externalId) ors.push({ externalId: match.externalId });
  if (!ors.length) return { updated: false };

  return prisma.$transaction(async (tx) => {
    const settlement = await tx.settlement.findFirst({ where: { kind: "buy", OR: ors } });
    if (!settlement || settlement.status !== "pending" || !settlement.userId) return { updated: false };
    const userId = settlement.userId;

    await tx.settlement.update({ where: { id: settlement.id }, data: { status } });

    const txn = settlement.reference
      ? await tx.transaction.findFirst({
          where: { userId, type: "buy", meta: { path: ["reference"], equals: settlement.reference } },
        })
      : null;
    if (txn) await tx.transaction.update({ where: { id: txn.id }, data: { status } });

    if (status === "completed") {
      const amount = settlement.amount;
      await tx.balance.upsert({
        where: { userId_symbol: { userId, symbol: settlement.asset } },
        create: { userId, symbol: settlement.asset, kind: kindOf(settlement.asset), amount },
        update: { amount: { increment: amount } },
      });
      // Crypto has left treasury into the user's custody.
      await adjustTreasury(tx, settlement.asset, -Number(amount));
      // Cashback on the naira volume of the buy, and the referrer's share of the spread.
      const raw = settlement.raw as { fiatAmount?: number; fiat?: string; spreadFiat?: number } | null;
      if (raw?.fiatAmount) await accrueCashback(tx, userId, raw.fiatAmount, { fiat: raw.fiat ?? "NGN", source: "buy" });
      if (raw?.spreadFiat) await accrueReferralEarning(tx, userId, raw.spreadFiat, { fiat: raw.fiat ?? "NGN", source: "buy" });
      return { updated: true, credited: true };
    }

    return { updated: true, credited: false };
  });
}
