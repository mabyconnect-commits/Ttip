import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { reconcilePendingBuys, refreshPayoutStatus } from "@/lib/settlement";
import { reconcileGiftCards } from "@/lib/settlement/giftcard-reconcile";
import { reconcileDeposits } from "@/lib/settlement/deposit-reconcile";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Finish what the webhooks didn't.
 *
 * A webhook is a promise, not a guarantee. It can be misconfigured at the
 * provider, dropped in transit, or delivered to a deployment that has since been
 * replaced — and every one of those leaves a transaction pending for ever.
 *
 * That is not theoretical: the admin list opened on buys from three days
 * earlier still reading "pending", with no way to tell whether the user had paid
 * and was owed crypto, or had walked away from the checkout page. Bills already
 * had a poller and crypto withdrawals already had one; buys had nothing at all,
 * and bank payouts were only ever refreshed when the user themselves opened
 * their history.
 *
 * So both are asked directly, on a schedule. The provider is the only thing that
 * actually knows.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const url = new URL(req.url);
    const bearer = req.headers.get("authorization");
    const ok = url.searchParams.get("key") === secret || bearer === `Bearer ${secret}`;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const buys = await reconcilePendingBuys().catch((e) => {
    console.error("[reconcile] buys failed", e);
    return { checked: 0, settled: 0, failed: 0 };
  });

  // Bank payouts: the webhook is the primary path and this is the backstop. A
  // minute of grace first, so a payout that is legitimately still in flight
  // isn't queried the instant it is created.
  const stale = await prisma.settlement.findMany({
    where: { kind: "payout", status: "pending", createdAt: { lte: new Date(Date.now() - 60_000) } },
    orderBy: { createdAt: "asc" },
    take: 25,
    select: { reference: true },
  });
  let payoutsChecked = 0;
  for (const s of stale) {
    if (!s.reference) continue;
    await refreshPayoutStatus(s.reference).catch(() => null);
    payoutsChecked++;
  }

  // Deposits: ask Dextopus what actually landed. This is the backstop deposits
  // never had — a missed webhook now costs minutes, not the deposit.
  const deposits = await reconcileDeposits(25).catch((e) => {
    console.error("[reconcile] deposits failed", e);
    return { usersChecked: 0, seen: 0, credited: 0, skipped: 0, why: { "poller-threw": 1 } };
  });

  // Gift cards: a code that wasn't ready at purchase is collected here, and an
  // order the provider never received releases the money back.
  const giftcards = await reconcileGiftCards(25).catch((e) => {
    console.error("[reconcile] gift cards failed", e);
    return { checked: 0, delivered: 0, refunded: 0 };
  });

  return NextResponse.json({ ok: true, buys, payoutsChecked, deposits, giftcards });
}
