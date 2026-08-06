import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { notifyUser } from "../push";
import { holdWindowMs, holdWindowMinutes } from "./float";

/**
 * Payouts waiting on naira that isn't there yet.
 *
 * The user's side is already done: their crypto is debited, the payout row
 * exists, the money is committed. What's missing is OUR naira at the provider,
 * and handing the transfer over anyway just produces a rejection the user can't
 * interpret.
 *
 * So it waits — but only for a fixed window, and the window is enforced by a
 * cron rather than by anyone remembering. Two outcomes, no third:
 *
 *   resolved  → an operator sent it, or the float was topped up and it went
 *               through on its own. The user sees "Sent".
 *   expired   → nobody resolved it in time. It fails, every funding leg is
 *               refunded, and the user is told their money is back.
 *
 * "Pending forever" is not on the list. A transfer that hangs with no deadline
 * is the worst outcome available: the user can neither spend the money nor
 * count on it arriving.
 */

export interface HoldInput {
  userId: string;
  reference: string;
  fiat: string;
  amountFiat: number;
  shortfallFiat: number;
  accountNumber: string;
  bankName?: string | null;
  accountName?: string | null;
  jobId?: string | null;
}

export async function holdPayout(input: HoldInput) {
  return prisma.payoutHold.create({
    data: {
      userId: input.userId,
      reference: input.reference,
      fiat: input.fiat,
      amountFiat: new Prisma.Decimal(input.amountFiat),
      shortfallFiat: new Prisma.Decimal(input.shortfallFiat),
      accountNumber: input.accountNumber,
      bankName: input.bankName ?? null,
      accountName: input.accountName ?? null,
      jobId: input.jobId ?? null,
      status: "held",
      deadline: new Date(Date.now() + holdWindowMs()),
    },
  });
}

/** What the operator is looking at: oldest deadline first, because it's next. */
export async function heldPayouts() {
  return prisma.payoutHold.findMany({
    where: { status: "held" },
    orderBy: { deadline: "asc" },
    take: 50,
  });
}

/**
 * An operator paid it out of band, or the float came good and it went through.
 *
 * Marks the payout completed through the normal path, so the transaction, the
 * settlement, the user's history and the push notification all say the same
 * thing they would for any other transfer.
 */
export async function resolveHold(
  reference: string,
  by: string,
  note?: string,
): Promise<{ ok: boolean; message: string }> {
  const { finalizePayout } = await import("./index");
  const hold = await prisma.payoutHold.findUnique({ where: { reference } });
  if (!hold) return { ok: false, message: "No held payout with that reference." };
  if (hold.status !== "held") return { ok: false, message: `That one is already ${hold.status}.` };

  const res = await finalizePayout({ reference }, "completed");
  if (!res.updated) return { ok: false, message: "The payout was no longer pending — nothing changed." };

  await prisma.payoutHold.update({
    where: { reference },
    data: { status: "completed", resolvedBy: by, resolvedAt: new Date(), note: note ?? null },
  });
  return { ok: true, message: "Marked as sent. The user sees it as completed." };
}

/**
 * Fail it now, on purpose — the operator knows it isn't going out.
 *
 * Better than letting the clock run: the user gets their money back sooner and
 * stops waiting on something that was never going to arrive.
 */
export async function failHold(reference: string, by: string, note?: string): Promise<{ ok: boolean; message: string }> {
  const { finalizePayout } = await import("./index");
  const hold = await prisma.payoutHold.findUnique({ where: { reference } });
  if (!hold) return { ok: false, message: "No held payout with that reference." };
  if (hold.status !== "held") return { ok: false, message: `That one is already ${hold.status}.` };

  const res = await finalizePayout({ reference }, "failed");
  await prisma.payoutHold.update({
    where: { reference },
    data: { status: "failed", resolvedBy: by, resolvedAt: new Date(), note: note ?? null },
  });
  return {
    ok: true,
    message: res.refunded ? "Failed and refunded to the user's wallets." : "Failed. Nothing needed refunding.",
  };
}

/**
 * The deadline, enforced.
 *
 * Runs on a schedule. Anything past its window fails and refunds — the same
 * path a provider rejection takes, so there is one definition of "this didn't
 * happen" and one refund that replays every funding leg.
 */
export async function expireHolds(): Promise<{ expired: number }> {
  const { finalizePayout } = await import("./index");
  const due = await prisma.payoutHold.findMany({
    where: { status: "held", deadline: { lte: new Date() } },
    take: 50,
  });

  let expired = 0;
  for (const hold of due) {
    // Claim first, so two overlapping runs can't both refund the same payout.
    const claimed = await prisma.payoutHold.updateMany({
      where: { id: hold.id, status: "held" },
      data: { status: "failed", resolvedBy: "auto", resolvedAt: new Date(), note: `Not resolved within ${holdWindowMinutes()} minutes` },
    });
    if (claimed.count === 0) continue;

    console.error(
      `[payout-hold] EXPIRED ${hold.reference} — ${hold.fiat} ${Number(hold.amountFiat)} to ${hold.accountNumber} ` +
        `was short ${Number(hold.shortfallFiat)} of float and nobody resolved it. Refunding.`,
    );
    await finalizePayout({ reference: hold.reference }, "failed");
    await notifyUser(hold.userId, {
      title: "Transfer not sent",
      body: `We couldn't complete your ${hold.fiat} ${Number(hold.amountFiat).toLocaleString("en-US")} transfer — the money is back in your wallet.`,
      url: "/account/transactions",
      tag: "payout",
    });
    expired++;
  }
  return { expired };
}
