import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { kindOf } from "../wallet";
import { payoutProvider, isLive } from "./config";
import { sandboxPayout } from "./sandbox";
import { flutterwavePayout, flutterwaveResolveAccount, flutterwaveTransferStatus } from "./flutterwave";
import { paystackPayout, paystackResolveAccount, paystackTransferStatus } from "./paystack";
import { monnifyPayout } from "./monnify";
import { coralpayPayout } from "./coralpay";
import { adjustTreasury } from "./treasury";
import { chainName } from "../chains";
import { notifyUser, pushMoney, type PushMessage } from "../push";
import { COMPANY } from "../company";
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
export { sendSolanaUsdc, sendSolanaNative, solanaWithdrawSupported, isValidSolanaAddress, SOLANA_WITHDRAW_ASSETS, solFeeReserve } from "./solana";
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
    const result = await prisma.$transaction(async (tx) => {
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

    // Tell them, on the lock screen, the moment it lands. AFTER the commit and
    // never inside it: a push service having a bad minute must not roll back a
    // deposit that has already been credited.
    if (result.credited) {
      const fiat = await depositFiatLine(resolvedUserId, deposit.asset, deposit.amount);
      void notifyUser(resolvedUserId, {
        title: `${deposit.asset} deposit`,
        body:
          `You received ${pushMoney(deposit.amount, deposit.asset)}${fiat}` +
          ` — credited to your ${COMPANY.product} wallet.`,
        url: "/home",
        tag: "deposit",
      });
    }
    return result;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { credited: false, userId: resolvedUserId, reason: "duplicate" };
    }
    throw e;
  }
}

/**
 * " · ₦13,755.08" — what the crypto is worth in their own currency.
 *
 * A deposit notification that says only "10 USDT" makes the reader do the
 * conversion themselves; the number they actually care about is the naira one.
 * Best-effort: no rate, no suffix, still a notification.
 */
async function depositFiatLine(userId: string, asset: string, amount: number): Promise<string> {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { defaultFiat: true } });
    const fiat = user?.defaultFiat;
    if (!fiat || fiat === asset) return "";
    const { referenceFiat } = await import("../rate");
    const value = await referenceFiat(amount, asset, fiat);
    return value > 0 ? ` · ${pushMoney(value, fiat)}` : "";
  } catch {
    return "";
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
/**
 * Ask the provider what actually happened to a payout, and settle it if it's
 * done.
 *
 * The webhook is the fast path, not the only path. When it doesn't arrive —
 * not configured, blocked by the network, delivered to a sibling product that
 * shares the account, or simply lost — nothing else ever moved the payout on,
 * so the transaction stayed "pending" and the user's receipt said "Processing"
 * for ever. This is the fallback that doesn't need anyone to call us.
 *
 * Returns the status now known. Cheap and safe to call on a read: it only ever
 * talks to the provider for a payout that is still pending, and finalizePayout
 * is idempotent, so a webhook and a poll racing each other settle once.
 */
export async function refreshPayoutStatus(
  reference: string,
  userId?: string,
): Promise<"pending" | "completed" | "failed" | null> {
  if (!reference) return null;

  const settlement = await prisma.settlement.findFirst({
    where: { kind: "payout", reference, ...(userId ? { userId } : {}) },
    select: { status: true },
  });
  if (!settlement) return null;
  if (settlement.status !== "pending") {
    return settlement.status === "completed" ? "completed" : "failed";
  }

  const provider = payoutProvider();
  const status =
    provider === "flutterwave"
      ? await flutterwaveTransferStatus(reference)
      : provider === "paystack"
        ? await paystackTransferStatus(reference)
        : null;

  if (status === "completed" || status === "failed") {
    await finalizePayout({ reference }, status);
    return status;
  }
  return "pending";
}

export async function finalizePayout(
  match: { externalId?: string; reference?: string },
  status: "completed" | "failed",
): Promise<{ updated: boolean; refunded?: boolean }> {
  const ors: { externalId?: string; reference?: string }[] = [];
  if (match.reference) ors.push({ reference: match.reference });
  if (match.externalId) ors.push({ externalId: match.externalId });
  if (!ors.length) return { updated: false };

  let settlementUser: string | null = null;
  const outcome = await prisma.$transaction(async (tx) => {
    const settlement = await tx.settlement.findFirst({ where: { kind: "payout", OR: ors } });
    if (!settlement || settlement.status !== "pending" || !settlement.userId) {
      return { updated: false as const, refunded: false, notify: null as PushMessage | null };
    }
    const settlementUserId = settlement.userId;
    settlementUser = settlementUserId;

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

    if (status === "failed" && txn) {
      // A payout can be funded from several wallets at once, so the refund has
      // to replay every leg. Refunding only assetIn/amountIn would hand back one
      // wallet's share and quietly keep the rest.
      const legs = (txn.meta as { legs?: { symbol: string; take: number }[] } | null)?.legs;
      const toRefund =
        legs && legs.length
          ? legs.map((l) => ({ symbol: l.symbol, amount: new Prisma.Decimal(l.take) }))
          : txn.assetIn && txn.amountIn
            ? [{ symbol: txn.assetIn, amount: txn.amountIn }]
            : [];

      for (const r of toRefund) {
        await tx.balance.upsert({
          where: { userId_symbol: { userId: settlementUserId, symbol: r.symbol } },
          create: { userId: settlementUserId, symbol: r.symbol, kind: kindOf(r.symbol), amount: r.amount },
          update: { amount: { increment: r.amount } },
        });
      }
      return { updated: true, refunded: toRefund.length > 0, notify: payoutNotice(txn, "failed") };
    }

    return { updated: true, refunded: false, notify: payoutNotice(txn, status) };
  });

  // Outside the transaction, and only once it actually changed something —
  // "your transfer went through" must never be sent for a webhook replay.
  if (outcome.updated && outcome.notify && settlementUser) {
    void notifyUser(settlementUser, outcome.notify);
  }
  return { updated: outcome.updated, refunded: outcome.refunded };
}

/**
 * What to tell someone when a payout settles.
 *
 * The failure case matters more than the success: their money has come back,
 * and until they know that they assume it is gone.
 */
function payoutNotice(
  txn: { amountOut: Prisma.Decimal | null; assetOut: string | null; counterparty: string | null } | null,
  status: "completed" | "failed",
): PushMessage | null {
  if (!txn?.amountOut || !txn.assetOut) return null;
  const money = pushMoney(Number(txn.amountOut), txn.assetOut);
  const to = txn.counterparty ? ` to ${txn.counterparty}` : "";
  return status === "completed"
    ? { title: "Transfer sent", body: `${money}${to} has arrived.`, url: "/account/transactions", tag: "payout" }
    : {
        title: "Transfer not sent",
        body: `${money}${to} didn't go through — the money is back in your wallet.`,
        url: "/account/transactions",
        tag: "payout",
      };
}

