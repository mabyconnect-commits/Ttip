import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";

/**
 * Find payouts that were marked FAILED and refunded, but may actually have been
 * sent.
 *
 * The bug: when the call to the provider threw — a timeout, a dropped
 * connection — the code recorded "failed", refunded the balance and told the
 * user nothing was charged. If the provider had in fact accepted and sent the
 * money, the user got their balance back on top of money that had left. Being
 * told it failed, they sent again. That is how one transfer became three.
 *
 * The code no longer does this (an unknown result is held pending), but the
 * rows it already wrote are still there. This lists them so each can be checked
 * against the provider dashboard by reference.
 *
 * Read-only, admin-only. It changes nothing — resolving these is a judgement
 * call per transaction, and it is not one a script should make.
 */

export const dynamic = "force-dynamic";

async function isAdmin(userId: string): Promise<boolean> {
  const raw = process.env.ADMIN_EMAILS ?? process.env.ADMIN_MAILS ?? "";
  const admins = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!admins.length) return false;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return !!user && admins.includes(user.email.toLowerCase());
}

export async function GET(req: Request) {
  const userId = await getUserId();
  if (!userId || !(await isAdmin(userId))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const days = Number(new URL(req.url).searchParams.get("days")) || 14;
  const since = new Date(Date.now() - days * 864e5);

  const failed = await prisma.transaction.findMany({
    where: { type: "withdraw_bank", status: "failed", createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { email: true, username: true, name: true } } },
  });

  // Group by user + destination + amount: a cluster is one transfer the user
  // retried because they were told it had failed. Those are the likeliest
  // duplicates at the bank.
  const clusters = new Map<string, typeof failed>();
  for (const t of failed) {
    const key = `${t.userId}|${t.counterparty}|${Number(t.amountOut).toFixed(2)}`;
    clusters.set(key, [...(clusters.get(key) ?? []), t]);
  }

  const suspicious = [...clusters.values()]
    .filter((rows) => rows.length > 1)
    .map((rows) => ({
      user: rows[0].user.email,
      name: rows[0].user.name,
      destination: rows[0].counterparty,
      amount: Number(rows[0].amountOut),
      currency: rows[0].assetOut,
      attempts: rows.length,
      // Check every one of these against the provider dashboard.
      references: rows.map((r) => (r.meta as { reference?: string } | null)?.reference ?? r.id),
      at: rows.map((r) => r.createdAt),
    }))
    .sort((a, b) => b.attempts - a.attempts);

  return NextResponse.json({
    window: `last ${days} days`,
    failedPayouts: failed.length,
    repeatedClusters: suspicious.length,
    /** Total that would have left the bank if EVERY attempt actually went out. */
    worstCaseExposure: suspicious.reduce((n, c) => n + c.amount * (c.attempts - 1), 0),
    clusters: suspicious,
    note:
      "Each of these was refunded in-app. Check every reference against your provider dashboard: " +
      "any that actually settled is money that left without a matching debit.",
  });
}
