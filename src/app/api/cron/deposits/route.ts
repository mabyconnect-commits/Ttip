import { NextResponse } from "next/server";
import { reconcileDeposits } from "@/lib/settlement/deposit-reconcile";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Deposits, checked every minute — on their own, not behind everything else.
 *
 * Deposits were reconciled inside /api/cron/reconcile on a five-minute
 * schedule, alongside buys, payouts and gift cards. Every other money flow in
 * this app that a user WATCHES runs every minute: withdrawals, bills, scheduled
 * transfers, payout holds. Deposits — the one flow where someone is staring at
 * their balance refreshing it — ran least often of all, and shared its budget
 * with three other jobs.
 *
 * So they get their own minute. Worst case for a deposit whose webhook never
 * arrives is now about sixty seconds, unattended. Nobody has to press Sync.
 *
 * Idempotent by construction: creditDeposit is keyed on the provider's own id,
 * so this racing the webhook credits once, not twice.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const url = new URL(req.url);
    const bearer = req.headers.get("authorization");
    const ok = url.searchParams.get("key") === secret || bearer === `Bearer ${secret}`;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const deposits = await reconcileDeposits(25).catch((e) => {
    console.error("[cron] deposits failed", e);
    return { usersChecked: 0, seen: 0, credited: 0, skipped: 0, why: { "poller-threw": 1 } };
  });

  return NextResponse.json({ ok: true, deposits });
}
