import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { kindOf } from "../wallet";
import { payoutProvider, isLive } from "./config";
import { sandboxPayout } from "./sandbox";
import { flutterwavePayout, flutterwaveResolveAccount } from "./flutterwave";
import { paystackPayout, paystackResolveAccount } from "./paystack";
import { monnifyPayout } from "./monnify";
import { coralpayPayout } from "./coralpay";
import { adjustTreasury } from "./treasury";
import { chainName } from "../chains";
import type { NormalizedDeposit, PayoutRequest, PayoutResult } from "./types";

export type { NormalizedDeposit, PayoutRequest, PayoutResult } from "./types";
export { settlementMode, isLive, payoutProvider, billProvider, demoEnabled, settlementEnabled, settlementStatus } from "./config";
export { payBill, finalizeBill, billStatus, validateBillCustomer, reconcilePendingBills } from "./billing";
export type { PayBillArgs, PayBillOutcome } from "./billing";
export { getBillCatalog, getCategoryCatalog, findBillItem } from "./bill-catalog";
export type { CategoryCatalog, ProviderGroup, BillItem } from "./bill-classify";
export { parseDeposit, verifyDepositSignature, parseDextopusDeposit, verifyDextopusSignature } from "./webhook";
export { ensureFloat, debitFloat, treasuryBalance, adjustTreasury } from "./treasury";
export { cryptoWithdraw, finalizeWithdrawal, reconcilePendingWithdrawals } from "./withdrawal";
export type { CryptoWithdrawRequest, CryptoWithdrawResult } from "./withdrawal";
export { dextopusWithdrawEnabled } from "./config";
export { dextopusValidateAddress, chainTypeForChainId, dextopusWithdrawPreview } from "./dextopus-withdraw";
export { sendSolanaUsdc, solanaWithdrawSupported, isValidSolanaAddress, SOLANA_WITHDRAW_ASSETS } from "./solana";
export { solanaConfig, maxCryptoWithdrawal } from "./config";
export { createBuyOrder, finalizeBuy } from "./buy";
export { ensureNairaAccount, creditNairaDeposit } from "./naira";
export type { NairaAccountResult } from "./naira";
// resolveAccountName is defined below (dispatches to the active provider).
export type { BuyRequest, BuyResult } from "./buy";
export { collectionProvider } from "./collection";
export { ensureDepositAddresses, getOrCreateDepositAddress } from "./provisioning";
export { listChains, listTokens } from "./dextopus";

/**
 * Credit a crypto deposit to a user's balance — the single path both the live
 * provider webhook and the in-app simulator flow through. Idempotent on
 * `externalId`: a webhook delivered twice credits exactly once.
 *
 * Returns the resolved userId, or null if the deposit could not be matched to a
 * user (unknown address) or was a duplicate.
 */
export async function creditDeposit(
  deposit: NormalizedDeposit,
  opts: { userId?: string } = {},
): Promise<{ credited: boolean; userId: string | null; reason?: string }> {
  // Resolve the user: passed directly (simulator), echoed by the provider
  // (Dextopus sets our userId), or looked up by deposit address.
  let userId = opts.userId ?? deposit.userId ?? null;
  if (!userId) {
    const addr = await prisma.walletAddress.findFirst({ where: { address: deposit.address } });
    userId = addr?.userId ?? null;
  }
  if (!userId) return { credited: false, userId: null, reason: "no user for address" };

  if (deposit.status !== "confirmed") {
    return { credited: false, userId, reason: "not yet confirmed" };
  }

  const resolvedUserId = userId;

  try {
    return await prisma.$transaction(async (tx) => {
      // Idempotency guard — unique externalId. A replay throws P2002 below.
      await tx.settlement.create({
        data: {
          userId: resolvedUserId,
          kind: "deposit",
          provider: deposit.provider,
          externalId: deposit.externalId,
          status: "completed",
          asset: deposit.asset,
          amount: new Prisma.Decimal(deposit.amount),
          chain: deposit.chain,
          address: deposit.address,
          raw: (deposit.raw ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        },
      });

      await tx.balance.upsert({
        where: { userId_symbol: { userId: resolvedUserId, symbol: deposit.asset } },
        create: { userId: resolvedUserId, symbol: deposit.asset, kind: kindOf(deposit.asset), amount: new Prisma.Decimal(deposit.amount) },
        update: { amount: { increment: deposit.amount } },
      });

      // The swept crypto is now held by the platform — record it in treasury so
      // the liquidity engine can later sell it into the fiat float.
      await adjustTreasury(tx, deposit.asset, deposit.amount);

      await tx.transaction.create({
        data: {
          userId: resolvedUserId,
          type: "deposit",
          status: "completed",
          assetOut: deposit.asset,
          amountOut: new Prisma.Decimal(deposit.amount),
          counterparty: "On-chain",
          note: `Received ${deposit.asset} via ${chainName(deposit.chain)}`,
          emoji: "📥",
          meta: {
            chain: chainName(deposit.chain),
            chainId: deposit.chainId ?? deposit.chain,
            txHash: deposit.txHash,
            externalId: deposit.externalId,
            provider: deposit.provider,
          },
        },
      });

      return { credited: true, userId: resolvedUserId };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { credited: false, userId: resolvedUserId, reason: "duplicate" };
    }
    throw e;
  }
}

/**
 * Resolve a bank account holder's name via the active provider, so the user can
 * confirm the recipient before sending. Needs a live provider — returns null in
 * sandbox/demo (no provider to ask).
 */
export async function resolveAccountName(bankName: string, accountNumber: string, currency: string): Promise<string | null> {
  if (!isLive()) return null;
  switch (payoutProvider()) {
    case "flutterwave":
      return flutterwaveResolveAccount(currency, bankName, accountNumber);
    case "paystack":
      return paystackResolveAccount(currency, bankName, accountNumber);
    default:
      return null;
  }
}

/** Send a fiat payout through the active provider (sandbox, Paystack or Flutterwave). */
export async function payoutFiat(req: PayoutRequest): Promise<PayoutResult> {
  switch (payoutProvider()) {
    case "paystack":
      return paystackPayout(req);
    case "flutterwave":
      return flutterwavePayout(req);
    case "monnify":
      return monnifyPayout(req);
    case "coralpay":
      return coralpayPayout(req);
    default:
      return sandboxPayout(req);
  }
}

/**
 * Verify + parse an inbound crypto-deposit webhook into a NormalizedDeposit.
 *
 * The generic contract (used by the sandbox and by a thin provider adapter): the
 * provider POSTs JSON and signs the raw body with HMAC-SHA256 using
 * DEPOSIT_WEBHOOK_SECRET, sending the hex digest in `x-ttip-signature`.
 *
 * Body shape:
 *   { id, address, asset, chain, amount, status? }
 */
/**
 * Finalize a fiat payout when the provider confirms it (via webhook). Marks the
 * settlement and its transaction completed/failed, and on failure refunds the
 * crypto that was debited when the payout was requested. Idempotent: acting on
 * an already-finalized settlement is a no-op.
 */
export async function finalizePayout(
  match: { externalId?: string; reference?: string },
  status: "completed" | "failed",
): Promise<{ updated: boolean; refunded?: boolean }> {
  const ors: { externalId?: string; reference?: string }[] = [];
  if (match.reference) ors.push({ reference: match.reference });
  if (match.externalId) ors.push({ externalId: match.externalId });
  if (!ors.length) return { updated: false };

  return prisma.$transaction(async (tx) => {
    const settlement = await tx.settlement.findFirst({ where: { kind: "payout", OR: ors } });
    if (!settlement || settlement.status !== "pending" || !settlement.userId) return { updated: false };
    const settlementUserId = settlement.userId;

    await tx.settlement.update({ where: { id: settlement.id }, data: { status } });

    // The payout's transaction carries the crypto debit and shares our reference.
    const txn = settlement.reference
      ? await tx.transaction.findFirst({
          where: { userId: settlementUserId, type: "withdraw_bank", meta: { path: ["reference"], equals: settlement.reference } },
        })
      : null;

    if (txn) {
      await tx.transaction.update({ where: { id: txn.id }, data: { status } });
    }

    if (status === "failed" && txn?.assetIn && txn.amountIn) {
      // Refund the debited crypto so the user isn't left short after a failed payout.
      await tx.balance.upsert({
        where: { userId_symbol: { userId: settlementUserId, symbol: txn.assetIn } },
        create: { userId: settlementUserId, symbol: txn.assetIn, kind: kindOf(txn.assetIn), amount: txn.amountIn },
        update: { amount: { increment: txn.amountIn } },
      });
      return { updated: true, refunded: true };
    }

    return { updated: true, refunded: false };
  });
}

