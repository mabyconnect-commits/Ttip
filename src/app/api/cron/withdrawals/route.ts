import { NextResponse } from "next/server";
import { reconcilePendingWithdrawals } from "@/lib/settlement";

export const dynamic = "force-dynamic";

/**
 * Reconcile pending Dextopus withdrawals: poll each one's status and finalize it
 * (deliver → completed with the destination tx hash, or failed/expired → refund).
 *
 * Wire this to Vercel Cron (e.g. every minute) via vercel.json. Protected by
 * CRON_SECRET when set — either `?key=` or an `Authorization: Bearer` header, so
 * both Vercel Cron and a manual curl work. Idempotent and safe to run often.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const url = new URL(req.url);
    const bearer = req.headers.get("authorization");
    const ok = url.searchParams.get("key") === secret || bearer === `Bearer ${secret}`;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await reconcilePendingWithdrawals();
  return NextResponse.json({ ok: true, ...result });
}
