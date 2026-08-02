import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { kindOf } from "../wallet";
import { billProvider } from "./config";
import { sandboxBillPay } from "./sandbox";
import { flutterwaveBillPay, flutterwaveBillStatus, flutterwaveValidateBill } from "./flutterwave";
import type { BillRequest, BillResult, BillValidation } from "./types";

/**
 * Bill payments (airtime, data, electricity, cable, …).
 *
 * Same money-safety shape as a bank payout: the crypto is debited and a pending
 * settlement written in ONE atomic step, then the biller is paid; a terminal
 * result finalizes now (refunding on failure) and a pending result waits for the
 * provider webhook (or a status re-query). Money can never leave a user's wallet
 * without a settlement row to match it, and a failed bill always refunds.
 */

/** Send the bill to the active provider (sandbox instant-settles; Flutterwave real). */
async function dispatchBill(req: BillRequest): Promise<BillResult> {
  switch (billProvider()) {
    case "flutterwave":
      return flutterwaveBillPay(req);
    default:
      return sandboxBillPay(req);
  }
}

/** Re-query a pending bill's status from the active provider (for reconciliation). */
export async function billStatus(reference: string): Promise<"pending" | "completed" | "failed" | null> {
  if (billProvider() === "flutterwave") return flutterwaveBillStatus(reference);
  return null;
}

/** Validate a bill customer (meter/smartcard name) via the active provider. */
export async function validateBillCustomer(category: string, customer: string): Promise<BillValidation> {
  if (billProvider() === "flutterwave") return flutterwaveValidateBill(category, customer);
  return { valid: false };
}

export interface PayBillArgs {
  userId: string;
  category: string;
  categoryTitle: string;
  categoryEmoji: string;
  provider: string;
  customer: string;
  /** Crypto asset debited from the user. */
  fundingSymbol: string;
  /** How much of `fundingSymbol` to debit (market value of the bill). */
  cost: number;
  /** Bill face value, in `currency`, delivered to the biller. */
  amountFiat: number;
  currency: string;
  reference: string;
}

export interface PayBillOutcome {
  status: "pending" | "completed" | "failed";
  message?: string;
}

/**
 * Pay a bill end to end. Throws (with the balance untouched / refunded) on
 * failure so the caller can surface the reason; returns the delivery status on
 * success. Assumes the caller validated the amount and balance.
 */
export async function payBill(args: PayBillArgs): Promise<PayBillOutcome> {
  const provider = billProvider();

  // 1. Atomic debit + pending records.
  await prisma.$transaction(async (tx) => {
    const bal = await tx.balance.findUnique({ where: { userId_symbol: { userId: args.userId, symbol: args.fundingSymbol } } });
    const have = bal ? Number(bal.amount) : 0;
    if (have + 1e-12 < args.cost) throw new Error(`Not enough ${args.fundingSymbol} to pay this bill`);

    await tx.balance.update({
      where: { userId_symbol: { userId: args.userId, symbol: args.fundingSymbol } },
      data: { amount: { decrement: args.cost } },
    });

    await tx.transaction.create({
      data: {
        userId: args.userId,
        type: "bill",
        status: "pending",
        assetIn: args.fundingSymbol,
        amountIn: new Prisma.Decimal(args.cost),
        assetOut: args.currency,
        amountOut: new Prisma.Decimal(args.amountFiat),
        counterparty: `${args.provider} · ${args.customer}`,
        note: `${args.categoryTitle} — ${args.provider}`,
        emoji: args.categoryEmoji,
        meta: { reference: args.reference, provider, category: args.category, customer: args.customer },
      },
    });

    await tx.settlement.create({
      data: {
        userId: args.userId,
        kind: "bill",
        provider,
        externalId: args.reference,
        reference: args.reference,
        status: "pending",
        asset: args.fundingSymbol,
        amount: new Prisma.Decimal(args.cost),
        address: args.customer,
        raw: { category: args.category, provider: args.provider, amountFiat: args.amountFiat, currency: args.currency } as Prisma.InputJsonValue,
      },
    });
  });

  // 2. Ask the provider to deliver the bill.
  let result: BillResult;
  try {
    result = await dispatchBill({
      userId: args.userId,
      category: args.category,
      provider: args.provider,
      customer: args.customer,
      amountFiat: args.amountFiat,
      currency: args.currency,
      reference: args.reference,
    });
  } catch (e) {
    result = { provider, externalId: args.reference, status: "failed", message: (e as Error).message };
  }

  // 3. Reconcile: terminal now (refund on failure); pending waits for the webhook.
  if (result.status === "completed" || result.status === "failed") {
    await finalizeBill({ reference: args.reference }, result.status);
  }

  if (result.status === "failed") {
    // finalizeBill has refunded the debited crypto.
    throw new Error(result.message || "Bill payment could not be completed — your balance was refunded.");
  }

  return { status: result.status, message: result.message };
}

/**
 * Finalize a bill when the provider confirms it (webhook) or on a terminal
 * dispatch result. Marks the settlement + transaction completed/failed and, on
 * failure, refunds the debited crypto. Idempotent: acting on an already-finalized
 * bill is a no-op.
 */
export async function finalizeBill(
  match: { externalId?: string; reference?: string },
  status: "completed" | "failed",
): Promise<{ updated: boolean; refunded?: boolean }> {
  const ors: { externalId?: string; reference?: string }[] = [];
  if (match.reference) ors.push({ reference: match.reference });
  if (match.externalId) ors.push({ externalId: match.externalId });
  if (!ors.length) return { updated: false };

  return prisma.$transaction(async (tx) => {
    const settlement = await tx.settlement.findFirst({ where: { kind: "bill", OR: ors } });
    if (!settlement || settlement.status !== "pending" || !settlement.userId) return { updated: false };
    const userId = settlement.userId;

    await tx.settlement.update({ where: { id: settlement.id }, data: { status } });

    const txn = settlement.reference
      ? await tx.transaction.findFirst({
          where: { userId, type: "bill", meta: { path: ["reference"], equals: settlement.reference } },
        })
      : null;

    if (txn) {
      await tx.transaction.update({ where: { id: txn.id }, data: { status } });
    }

    if (status === "failed") {
      // Refund the debited crypto (settlement.amount holds what was taken).
      await tx.balance.upsert({
        where: { userId_symbol: { userId, symbol: settlement.asset } },
        create: { userId, symbol: settlement.asset, kind: kindOf(settlement.asset), amount: settlement.amount },
        update: { amount: { increment: settlement.amount } },
      });
      return { updated: true, refunded: true };
    }

    return { updated: true, refunded: false };
  });
}
