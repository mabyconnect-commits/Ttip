import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { heldPayouts, resolveHold, failHold } from "@/lib/settlement/payout-hold";
import { openTopUps, completeTopUp, holdWindowMinutes, settleVenue, topupBuffer } from "@/lib/settlement/float";
import { treasuryBalance, adjustTreasury } from "@/lib/settlement/treasury";
import { bybitBalance, bybitEnabled, bybitDepositAddress } from "@/lib/settlement/bybit";
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
    symbol?: string;
    amount?: number;
  };

  if (body.action === "sent" && body.reference) {
    return NextResponse.json(await resolveHold(body.reference, admin.email, body.note));
  }
  if (body.action === "fail" && body.reference) {
    return NextResponse.json(await failHold(body.reference, admin.email, body.note));
  }
  /**
   * Does Bybit answer?
   *
   * Setting this up means putting two secrets into Vercel and hoping. The first
   * time anyone finds out whether they were right should not be the first time
   * a real payout is short of naira — so this makes both calls now and reports
   * exactly what came back.
   */
  if (body.action === "ping") {
    if (!bybitEnabled()) {
      return NextResponse.json({
        ok: false,
        message: "BYBIT_API_KEY / BYBIT_API_SECRET are not set on this deployment.",
      });
    }
    const [address, balance] = await Promise.all([bybitDepositAddress(), bybitBalance()]);
    return NextResponse.json({
      ok: !!address,
      depositAddress: address?.address ?? null,
      chain: address?.chain ?? null,
      balance,
      message: address
        ? `Bybit answered. Deposit address on ${address.chain}, balance ${balance ?? "unknown"}.`
        : "Bybit rejected the call — check the key's permissions and the server log for the exact reason.",
    });
  }

  /**
   * Tell the ledger what the treasury actually holds.
   *
   * The treasury balance is normally built up by deposit sweeps, which means a
   * fresh deployment reads zero however much USDC the wallet really has — and
   * raiseFloat refuses to send coins it doesn't believe exist. This is the one
   * honest way to start: an operator states the figure, and it is written with
   * an audit row rather than edited into the database by hand.
   */
  if (body.action === "setTreasury") {
    const symbol = (body.symbol ?? "").trim().toUpperCase();
    const amount = Number(body.amount);
    if (!symbol) return NextResponse.json({ ok: false, message: "Which asset?" }, { status: 400 });
    if (!Number.isFinite(amount) || amount < 0) {
      return NextResponse.json({ ok: false, message: "Enter the amount the wallet holds." }, { status: 400 });
    }

    const current = await treasuryBalance(symbol);
    const delta = amount - current;
    await prisma.$transaction(async (tx) => {
      await adjustTreasury(tx, symbol, delta);
      await tx.settlement.create({
        data: {
          userId: null,
          kind: "treasury_adjust",
          provider: "manual",
          externalId: `treasury_${symbol}_${Date.now()}`,
          status: "completed",
          asset: symbol,
          amount: new Prisma.Decimal(delta),
          raw: { from: current, to: amount, by: admin.email } as Prisma.InputJsonValue,
        },
      });
    });
    console.error(`[treasury] ${admin.email} set ${symbol} from ${current} to ${amount}`);
    return NextResponse.json({ ok: true, message: `${symbol} treasury recorded as ${amount}.`, from: current, to: amount });
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
