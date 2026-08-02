import "server-only";
import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { kindOf } from "../wallet";
import { collectionProvider } from "./collection";
import { flutterwaveCreateVirtualAccount } from "./flutterwave";

/**
 * Naira on-ramp via a dedicated virtual account (DVA). Each verified user gets a
 * permanent bank account number; money transferred to it lands in their naira
 * balance (via the collection webhook), which they can then swap to any crypto.
 */

/**
 * Ensure the user has a dedicated naira account, creating one via the provider if
 * needed. Requires a BVN (permanent DVAs need it) — call this at KYC time. Returns
 * the account, or null if the provider isn't Flutterwave or creation failed.
 */
export type NairaAccountResult =
  | { ok: true; accountNumber: string; bankName: string }
  | { ok: false; error: string };

export async function ensureNairaAccount(
  userId: string,
  opts: { bvn: string; name: string; email: string },
): Promise<NairaAccountResult> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { nairaAccount: true, nairaBank: true } });
  if (user?.nairaAccount) return { ok: true, accountNumber: user.nairaAccount, bankName: user.nairaBank ?? "" };
  if (collectionProvider() !== "flutterwave") {
    return { ok: false, error: "Naira accounts need the Flutterwave collection provider (set COLLECTION_PROVIDER=flutterwave)." };
  }
  if (!/^\d{11}$/.test(opts.bvn)) {
    return { ok: false, error: "A valid 11-digit BVN is required to open a dedicated naira account." };
  }

  const acct = await flutterwaveCreateVirtualAccount(opts.email, opts.bvn, opts.name, "dva_" + crypto.randomUUID());
  if ("error" in acct) return { ok: false, error: acct.error };
  await prisma.user.update({ where: { id: userId }, data: { nairaAccount: acct.accountNumber, nairaBank: acct.bankName } });
  return { ok: true, accountNumber: acct.accountNumber, bankName: acct.bankName };
}

/**
 * Credit an inbound naira deposit (someone funded their DVA) to the user's
 * balance. Idempotent on `externalId` (the provider transaction id): a webhook
 * delivered twice credits once.
 */
export async function creditNairaDeposit(opts: {
  userId: string;
  amount: number;
  currency: string;
  externalId: string;
  raw?: unknown;
}): Promise<{ credited: boolean }> {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.settlement.create({
        data: {
          userId: opts.userId,
          kind: "deposit",
          provider: "flutterwave",
          externalId: opts.externalId,
          status: "completed",
          asset: opts.currency,
          amount: new Prisma.Decimal(opts.amount),
          raw: (opts.raw ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        },
      });
      await tx.balance.upsert({
        where: { userId_symbol: { userId: opts.userId, symbol: opts.currency } },
        create: { userId: opts.userId, symbol: opts.currency, kind: kindOf(opts.currency), amount: new Prisma.Decimal(opts.amount) },
        update: { amount: { increment: opts.amount } },
      });
      await tx.transaction.create({
        data: {
          userId: opts.userId,
          type: "deposit",
          status: "completed",
          assetOut: opts.currency,
          amountOut: new Prisma.Decimal(opts.amount),
          counterparty: "Bank transfer",
          note: `Added ${opts.currency} via bank transfer`,
          emoji: "🏦",
        },
      });
      return { credited: true };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { credited: false };
    throw e;
  }
}
