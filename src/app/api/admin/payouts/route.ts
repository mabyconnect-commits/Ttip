import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { heldPayouts, resolveHold, failHold } from "@/lib/settlement/payout-hold";
import { openTopUps, completeTopUp, holdWindowMinutes, settleVenue, topupBuffer } from "@/lib/settlement/float";
import { treasuryBalance } from "@/lib/settlement/treasury";
import { bybitBalance, bybitEnabled } from "@/lib/settlement/bybit";
import { explorerTxUrl } from "@/lib/chains";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The desk an operator works from when a payout is waiting on naira.
 *
 * Everything needed to finish one, in one response: what's held and how long
 * is left on each, the top-up already sent to the exchange (with the on-chain
 * link, so it can be verified rather than trusted), and what the float actually
 * holds right now.
 *
 * Operator-only; anyone else gets a 404 rather than a 403, because the
 * existence of this endpoint is itself information.
 */

async function isAdmin(userId: string): Promise<{ ok: boolean; email: string }> {
  const raw = process.env.ADMIN_EMAILS ?? process.env.ADMIN_MAILS ?? "";
  const admins = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) return { ok: false, email: "" };
  if (!admins.length) return { ok: false, email: user.email };
  return { ok: admins.includes(user.email.toLowerCase()), email: user.email };
}

export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const admin = await isAdmin(userId);
  if (!admin.ok) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [holds, topups] = await Promise.all([heldPayouts(), openTopUps()]);
  const fiats = [...new Set(holds.map((h) => h.fiat))];
  const floats: Record<string, number> = {};
  for (const f of fiats.length ? fiats : ["NGN"]) floats[f] = await treasuryBalance(f);

  return NextResponse.json({
    holdWindowMinutes: holdWindowMinutes(),
    bufferPct: topupBuffer(),
    venue: settleVenue(),
    floats,
    treasuryUsdc: await treasuryBalance("USDC"),
    // What the exchange itself says it holds — the number that tells an
    // operator whether the USDC has actually landed yet.
    venueBalance: bybitEnabled() ? await bybitBalance() : null,
    holds: holds.map((h) => ({
      reference: h.reference,
      fiat: h.fiat,
      amountFiat: Number(h.amountFiat),
      shortfallFiat: Number(h.shortfallFiat),
      accountNumber: h.accountNumber,
      bankName: h.bankName,
      accountName: h.accountName,
      jobId: h.jobId,
      deadline: h.deadline,
      secondsLeft: Math.max(0, Math.round((h.deadline.getTime() - Date.now()) / 1000)),
    })),
    topups: topups.map((j) => ({
      id: j.id,
      status: j.status,
      fiat: j.fiat,
      targetFiat: Number(j.targetFiat),
      asset: j.asset,
      amountAsset: Number(j.amountAsset),
      depositAddress: j.depositAddress,
      fundingTx: j.fundingTx,
      // Solana — the chain the treasury signs on.
      fundingTxUrl: explorerTxUrl(792703809, j.fundingTx),
      reference: j.reference,
      error: j.error,
      createdAt: j.createdAt,
    })),
  });
}

/**
 * Resolve one.
 *
 *   action=sent      → the operator sent it. Completed, user sees "Sent".
 *   action=fail      → it isn't going out. Failed now, refunded now, rather
 *                      than making the user wait out the clock.
 *   action=toppedUp  → the P2P sell is done; credit the float with what
 *                      actually landed. Their number, not our target.
 */
export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const admin = await isAdmin(userId);
  if (!admin.ok) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    reference?: string;
    jobId?: string;
    raisedFiat?: number;
    note?: string;
  };

  if (body.action === "sent" && body.reference) {
    return NextResponse.json(await resolveHold(body.reference, admin.email, body.note));
  }
  if (body.action === "fail" && body.reference) {
    return NextResponse.json(await failHold(body.reference, admin.email, body.note));
  }
  if (body.action === "toppedUp" && body.jobId) {
    const raised = Number(body.raisedFiat);
    if (!(raised > 0)) {
      return NextResponse.json({ ok: false, message: "Enter the amount that actually landed." }, { status: 400 });
    }
    const done = await completeTopUp(body.jobId, raised);
    return NextResponse.json({
      ok: done,
      message: done
        ? "Float credited. Any held payout it covers can be marked sent."
        : "That top-up is already closed.",
    });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
