import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { kindOf } from "../wallet";
import { isLive, depositProvider } from "./config";

/**
 * Crypto withdrawal (send crypto off-platform to an external wallet).
 *
 * Honesty matters here: moving crypto out means a real on-chain transfer signed
 * from the treasury. We never mark a withdrawal "completed" unless it actually
 * settled.
 *
 *   - sandbox: settles instantly with a simulated tx hash, so the flow is
 *     demoable end-to-end.
 *   - live: the withdrawal is queued as **pending** and awaits the treasury
 *     signer / provider. It completes only when `finalizeWithdrawal` is called
 *     with the on-chain tx hash (by the signer service or an ops action). The
 *     user sees "processing", not a false "sent".
 *
 * Either way the debit + settlement row are written atomically before we attempt
 * to move anything, and a failure refunds the user.
 */

export interface CryptoWithdrawRequest {
  userId: string;
  asset: string; // USDT, USDC, BTC, ETH, SOL, …
  amount: number; // amount of `asset` to send (before network fee)
  fee: number; // network fee, in `asset`
  address: string; // destination wallet address
  network?: string; // human label, e.g. "TRC-20 (Tron)"
  chainId?: number; // numeric chain id for the explorer link
  reference: string; // our idempotency reference
}

export interface CryptoWithdrawResult {
  provider: string;
  status: "pending" | "completed" | "failed";
  txHash?: string;
  message?: string;
}

/** Dispatch the actual send. Sandbox simulates; live queues for the treasury signer. */
async function dispatchCryptoWithdraw(req: CryptoWithdrawRequest): Promise<CryptoWithdrawResult> {
  if (!isLive()) {
    // Simulated on-chain settlement for demos.
    const txHash = "sbx_" + req.reference.replace(/[^a-z0-9]/gi, "").slice(-16);
    return { provider: "sandbox", status: "completed", txHash };
  }
  // Live: we do not hold an automated signer in-process. Queue the withdrawal as
  // pending; the treasury signer (or ops) broadcasts it and calls
  // finalizeWithdrawal with the tx hash. This is deliberately not auto-completed.
  return { provider: depositProvider(), status: "pending", message: "Queued for on-chain processing" };
}

/**
 * Debit the user's crypto and record a pending withdrawal atomically, then
 * attempt to send. Returns the transaction status and (when settled) the tx hash.
 * Throws on insufficient balance; the caller has already validated the address.
 */
export async function cryptoWithdraw(req: CryptoWithdrawRequest): Promise<CryptoWithdrawResult & { fiatSafe: true }> {
  const total = req.amount + req.fee;

  // 1. Atomic debit + pending records.
  await prisma.$transaction(async (tx) => {
    const bal = await tx.balance.findUnique({ where: { userId_symbol: { userId: req.userId, symbol: req.asset } } });
    const have = bal ? Number(bal.amount) : 0;
    if (have + 1e-12 < total) throw new Error(`Insufficient ${req.asset} to cover amount + network fee`);

    await tx.balance.update({
      where: { userId_symbol: { userId: req.userId, symbol: req.asset } },
      data: { amount: { decrement: total } },
    });

    await tx.transaction.create({
      data: {
        userId: req.userId,
        type: "withdraw_wallet",
        status: "pending",
        assetIn: req.asset,
        amountIn: new Prisma.Decimal(req.amount),
        counterparty: req.address,
        note: `Sent ${req.asset} on ${req.network ?? "network"}`,
        emoji: "🔗",
        meta: { network: req.network, chainId: req.chainId, fee: req.fee, reference: req.reference },
      },
    });

    await tx.settlement.create({
      data: {
        userId: req.userId,
        kind: "withdrawal",
        provider: isLive() ? depositProvider() : "sandbox",
        externalId: req.reference,
        reference: req.reference,
        status: "pending",
        asset: req.asset,
        amount: new Prisma.Decimal(total),
        address: req.address,
        raw: { network: req.network, chainId: req.chainId, fee: req.fee } as Prisma.InputJsonValue,
      },
    });
  });

  // 2. Attempt the send.
  let result: CryptoWithdrawResult;
  try {
    result = await dispatchCryptoWithdraw(req);
  } catch (e) {
    result = { provider: "sandbox", status: "failed", message: (e as Error).message };
  }

  // 3. Reconcile terminal outcomes now; pending waits for finalizeWithdrawal.
  if (result.status === "completed" || result.status === "failed") {
    await finalizeWithdrawal({ reference: req.reference }, result.status, result.txHash);
  }

  if (result.status === "failed") {
    throw new Error(result.message || "Withdrawal could not be sent — your balance was refunded.");
  }

  return { ...result, fiatSafe: true };
}

/**
 * Finalize a crypto withdrawal once the chain confirms (or it fails). Marks the
 * settlement + transaction, records the tx hash for the explorer link, and
 * refunds the debited crypto on failure. Idempotent.
 */
export async function finalizeWithdrawal(
  match: { externalId?: string; reference?: string },
  status: "completed" | "failed",
  txHash?: string,
): Promise<{ updated: boolean; refunded?: boolean }> {
  const ors: { externalId?: string; reference?: string }[] = [];
  if (match.reference) ors.push({ reference: match.reference });
  if (match.externalId) ors.push({ externalId: match.externalId });
  if (!ors.length) return { updated: false };

  return prisma.$transaction(async (tx) => {
    const settlement = await tx.settlement.findFirst({ where: { kind: "withdrawal", OR: ors } });
    if (!settlement || settlement.status !== "pending" || !settlement.userId) return { updated: false };
    const userId = settlement.userId;

    await tx.settlement.update({ where: { id: settlement.id }, data: { status } });

    const txn = settlement.reference
      ? await tx.transaction.findFirst({
          where: { userId, type: "withdraw_wallet", meta: { path: ["reference"], equals: settlement.reference } },
        })
      : null;

    if (txn) {
      const meta = { ...((txn.meta as Record<string, unknown>) ?? {}), ...(txHash ? { txHash } : {}) };
      await tx.transaction.update({ where: { id: txn.id }, data: { status, meta: meta as Prisma.InputJsonValue } });
    }

    if (status === "failed" && txn?.assetIn && txn.amountIn) {
      // Refund amount + fee (settlement.amount holds the total that was debited).
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
