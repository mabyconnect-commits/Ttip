import { NextResponse } from "next/server";
import { expireHolds } from "@/lib/settlement/payout-hold";

export const dynamic = "force-dynamic";

/**
 * The 20-minute deadline, enforced.
 *
 * A held payout waits for the naira float to be topped up. If nobody resolves
 * it in the window, this fails it and refunds every funding leg — because the
 * alternative is a transfer that hangs indefinitely, which leaves the user
 * unable to spend the money OR to count on it arriving. Deadlines that depend
 * on somebody remembering are not deadlines.
 *
 * Wired to Vercel Cron every minute, protected by CRON_SECRET like the others.
 * Claiming is a conditional update inside expireHolds, so two overlapping runs
 * cannot both refund the same payout.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const url = new URL(req.url);
    const bearer = req.headers.get("authorization");
    const ok = url.searchParams.get("key") === secret || bearer === `Bearer ${secret}`;
    if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await expireHolds();
  return NextResponse.json({ ok: true, ...result });
}
