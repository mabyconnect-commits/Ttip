import "server-only";
import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { kindOf } from "../wallet";
import { depositFeeFor } from "../pricing";
import { collectionProvider } from "./collection";
import { flutterwaveCreateVirtualAccount } from "./flutterwave";
import { notifyUser, pushMoney } from "../push";
import { COMPANY } from "../company";

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
  /** `created` = the account was opened on THIS call, which is the only case
   *  where Flutterwave actually validated the BVN against NIBSS. */
  | { ok: true; created: boolean; accountNumber: string; bankName: string }
  | { ok: false; error: string };

export async function ensureNairaAccount(
  userId: string,
  opts: { bvn: string; name: string; email: string },
): Promise<NairaAccountResult> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { nairaAccount: true, nairaBank: true } });
  // NOTE `created`: an existing account is returned WITHOUT validating the BVN
  // passed in — nothing was checked against NIBSS on this call. Callers using
  // this as an identity check must require `created === true`, or any 11-digit
  // number would "verify" a user who already has an account.
  if (user?.nairaAccount) {
    return { ok: true, created: false, accountNumber: user.nairaAccount, bankName: user.nairaBank ?? "" };
  }
  if (collectionProvider() !== "flutterwave") {
    return { ok: false, error: "Naira accounts need the Flutterwave collection provider (set COLLECTION_PROVIDER=flutterwave)." };
  }
  if (!/^\d{11}$/.test(opts.bvn)) {
    return { ok: false, error: "A valid 11-digit BVN is required to open a dedicated naira account." };
  }

  const acct = await flutterwaveCreateVirtualAccount(opts.email, opts.bvn, opts.name, "dva_" + crypto.randomUUID());
  if ("error" in acct) return { ok: false, error: acct.error };
  await prisma.user.update({ where: { id: userId }, data: { nairaAccount: acct.accountNumber, nairaBank: acct.bankName } });
  return { ok: true, created: true, accountNumber: acct.accountNumber, bankName: acct.bankName };
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
  // The provider bills us to collect this money (Flutterwave ~1.5% on NGN), so
  // crediting the gross amount lost that fee on EVERY deposit. The user is
  // credited net of the fee, exactly as they are on a payout. This is separate
  // from the trading spread — that's what we earn for converting, not a subsidy
  // for the collection charge.
  const fee = depositFeeFor(opts.amount, opts.currency);
  const net = Math.max(0, opts.amount - fee);

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.settlement.create({
        data: {
          userId: opts.userId,
          kind: "deposit",
          provider: "flutterwave",
          externalId: opts.externalId,
          status: "completed",
          asset: opts.currency,
          // The gross that actually arrived — reconciliation against the
          // provider has to match their figure, not ours.
          amount: new Prisma.Decimal(opts.amount),
          raw: (opts.raw ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        },
      });
      await tx.balance.upsert({
        where: { userId_symbol: { userId: opts.userId, symbol: opts.currency } },
        create: { userId: opts.userId, symbol: opts.currency, kind: kindOf(opts.currency), amount: new Prisma.Decimal(net) },
        update: { amount: { increment: net } },
      });
      await tx.transaction.create({
        data: {
          userId: opts.userId,
          type: "deposit",
          status: "completed",
          assetOut: opts.currency,
          amountOut: new Prisma.Decimal(net),
          counterparty: "Bank transfer",
          note: fee > 0
            ? `Added ${opts.currency} via bank transfer · fee ${fee.toLocaleString()}`
            : `Added ${opts.currency} via bank transfer`,
          emoji: "🏦",
          // `fee` is what the revenue dashboard reads; `gross` keeps the
          // pre-fee amount on the record for support and reconciliation.
          // externalId ties this line back to its settlement row. Without it the
          // ledger audit can only guess by timing, and a deposit that is perfectly
          // fine reads as one that never reached the user.
          meta: { fee, gross: opts.amount, currency: opts.currency, externalId: opts.externalId },
        },
      });
      return { credited: true };
    });

    // After the commit, never inside it: a push that fails must not undo a
    // deposit that has already landed.
    if (result.credited) {
      void notifyUser(opts.userId, {
        title: "Money in",
        body: `${pushMoney(net, opts.currency)} has been credited to your ${COMPANY.product} wallet.`,
        url: "/home",
        tag: "deposit",
      });
    }
    return result;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { credited: false };
    throw e;
  }
}
