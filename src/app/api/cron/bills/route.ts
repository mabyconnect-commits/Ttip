import { NextResponse } from "next/server";
import { reconcilePendingBills } from "@/lib/settlement";

export const dynamic = "force-dynamic";

/**
 * Reconcile pending bill payments: re-query each one's delivery status and
 * finalize the terminal ones (completed → draw the float down; failed → refund
 * the debited crypto). Flutterwave doesn't reliably webhook bill delivery, so
 * this is what stops a delivered bill from sitting on "Pending" forever.
 *
 * Wired to Vercel Cron via vercel.json. Protected by CRON_SECRET when set —
 * either `?key=` or an `Authorization: Bearer` header, so both Vercel Cron and a
 * manual curl work. Idempotent and safe to run often.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const url = new URL(req.url);
    const bearer = req.headers.get("authorization");
    const ok = url.searchParams.get("key") === secret || bearer === `Bearer ${secret}`;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await reconcilePendingBills();
  return NextResponse.json({ ok: true, ...result });
}
