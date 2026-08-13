import "server-only";
import { prisma } from "../db";
import { listDeposits } from "./dextopus";
import { parseDextopusDeposit } from "./webhook";
import { scaleDepositAmount } from "./deposit-amount";
import { creditDeposit } from "./index";

/**
 * Ask Dextopus what actually landed, instead of waiting to be told.
 *
 * THE structural fix. Every other money flow in this app already polls — bills,
 * buys, crypto withdrawals, bank payouts all have a reconciler that asks the
 * provider directly, because a webhook is a promise and not a guarantee.
 * Deposits alone had a single delivery path. One dropped request, one rejected
 * signature, one unregistered URL, and the money settled into treasury while
 * the app never learned it existed. That is every "it reached the treasury but
 * never showed up" report in one sentence.
 *
 * Now a missed webhook costs a few minutes rather than the deposit.
 *
 * Safe to run repeatedly: creditDeposit is keyed on the provider's own id and a
 * replay hits the unique constraint, so a deposit cannot credit twice however
 * often this runs or how many webhooks arrive alongside it.
 */

export interface DepositReconcileResult {
  usersChecked: number;
  seen: number;
  credited: number;
  skipped: number;
}

export async function reconcileDeposits(limitUsers = 25, onlyUserId?: string): Promise<DepositReconcileResult> {
  const result: DepositReconcileResult = { usersChecked: 0, seen: 0, credited: 0, skipped: 0 };

  // Users who actually have a Dextopus address — nobody else can have deposited.
  const rows = onlyUserId
    ? [{ userId: onlyUserId }]
    : await prisma.walletAddress.findMany({
        where: { provider: "dextopus" },
        distinct: ["userId"],
        select: { userId: true },
        orderBy: { id: "desc" },
        take: Math.max(1, Math.min(limitUsers, 200)),
      });

  for (const { userId } of rows) {
    result.usersChecked++;
    const records = await listDeposits({ userId }).catch(() => []);

    for (const record of records) {
      result.seen++;

      // Reuse the webhook parser so the poller and the webhook can never
      // disagree about what a payload means.
      let deposit;
      try {
        deposit = parseDextopusDeposit({ data: record, event: undefined });
      } catch {
        result.skipped++;
        continue;
      }
      if (deposit.status !== "confirmed") continue;

      // Already recorded? Cheap check before doing anything heavier.
      const existing = await prisma.settlement.findUnique({
        where: { externalId: deposit.externalId },
        select: { id: true },
      });
      if (existing) continue;

      // Base units → tokens, exactly as the webhook does.
      const scaled = await scaleDepositAmount(deposit);
      if (!scaled.deposit) {
        console.error("[deposit] poller could not scale", deposit.externalId, scaled.reason);
        result.skipped++;
        continue;
      }

      // Dextopus echoes our userId, but fall back to the one we polled for.
      const credit = await creditDeposit({ ...scaled.deposit, userId: scaled.deposit.userId ?? userId }).catch(
        (e) => {
          console.error("[deposit] poller credit failed", deposit.externalId, e);
          return { credited: false, userId: null, reason: "threw" };
        },
      );
      if (credit.credited) result.credited++;
      else result.skipped++;
    }
  }

  return result;
}
