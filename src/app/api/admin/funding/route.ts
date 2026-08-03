import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { toUsd } from "@/lib/prices";

export const dynamic = "force-dynamic";

/**
 * Funding audit + clawback, over HTTP — the same logic as
 * `npm run audit:funding` / `npm run clawback`, reachable from a browser so it
 * can be run without a terminal or database URL to hand.
 *
 * Restricted to ADMIN_EMAILS; everyone else gets 404 (not 403 — an unauthorised
 * caller shouldn't learn the endpoint exists).
 *
 *   GET  /api/admin/funding             → read-only report, changes nothing
 *   POST /api/admin/funding?apply=1     → debit the unfunded balances
 *   POST /api/admin/funding?apply=1&user=someone@example.com  → one account
 *
 * Safety, identical to the CLI: never takes a balance negative, never touches
 * platform promos, only debits the specific assets that were simulated, writes
 * an `adjustment` transaction per debit, and subtracts prior reversals so
 * running it twice can't double-charge.
 */

const REAL_PROVIDERS = ["dextopus", "flutterwave", "paystack", "monnify", "coralpay"];
const GRANT_TYPES = ["deposit_bonus", "referral_bonus", "referral_withdraw", "cashback"];

async function isAdmin(userId: string): Promise<boolean> {
  const raw = process.env.ADMIN_EMAILS ?? process.env.ADMIN_MAILS ?? "";
  const admins = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!admins.length) return false; // no admin list → endpoint stays closed
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return !!user && admins.includes(user.email.toLowerCase());
}

interface Debit {
  symbol: string;
  debit: number;
  shortfall: number;
}

/** Unfunded amount per asset for one user, net of anything already reversed. */
async function unfundedFor(userId: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();

  const settlements = await prisma.settlement.findMany({
    where: { userId, status: "completed", kind: { in: ["deposit", "buy"] } },
  });
  for (const s of settlements) {
    if (REAL_PROVIDERS.includes(s.provider)) continue;
    out.set(s.asset, (out.get(s.asset) ?? 0) + Number(s.amount));
  }

  // The old simulator's fiat branch wrote a transaction and no settlement.
  const fiatSims = await prisma.transaction.findMany({
    where: { userId, type: "deposit", status: "completed", counterparty: "Bank transfer" },
  });
  for (const t of fiatSims) {
    const asset = t.assetOut ?? "NGN";
    out.set(asset, (out.get(asset) ?? 0) + Number(t.amountOut ?? 0));
  }

  // Balances with no deposit provenance at all (demo seed / manual edits), less
  // whatever promos legitimately explain.
  if (settlements.length === 0 && fiatSims.length === 0) {
    const [balances, grants] = await Promise.all([
      prisma.balance.findMany({ where: { userId } }),
      prisma.transaction.findMany({ where: { userId, status: "completed", type: { in: GRANT_TYPES } } }),
    ]);
    const granted = new Map<string, number>();
    for (const g of grants) {
      const a = g.assetOut ?? "NGN";
      granted.set(a, (granted.get(a) ?? 0) + Number(g.amountOut ?? 0));
    }
    for (const b of balances) {
      const unexplained = Number(b.amount) - (granted.get(b.symbol) ?? 0);
      if (unexplained > 0) out.set(b.symbol, unexplained);
    }
  }

  // Net off previous clawbacks so a re-run is a no-op, not a second charge.
  const prior = await prisma.transaction.findMany({
    where: { userId, type: "adjustment", meta: { path: ["reason"], equals: "unfunded_credit_reversal" } },
  });
  for (const r of prior) {
    const asset = r.assetIn ?? "";
    if (!out.has(asset)) continue;
    const left = (out.get(asset) ?? 0) - Number(r.amountIn ?? 0);
    if (left > 1e-9) out.set(asset, left);
    else out.delete(asset);
  }

  return out;
}

async function report(userFilter?: string) {
  const users = await prisma.user.findMany({
    where: userFilter ? { OR: [{ email: userFilter }, { username: userFilter }, { id: userFilter }] } : undefined,
    include: { balances: true },
    orderBy: { createdAt: "asc" },
  });

  const rows = [];
  let totalRecoverableUsd = 0;
  let totalGoneUsd = 0;

  for (const u of users) {
    const unfunded = await unfundedFor(u.id);
    if (!unfunded.size) continue;

    const debits: Debit[] = [];
    let recoverableUsd = 0;
    let goneUsd = 0;
    for (const [symbol, amount] of unfunded) {
      const bal = Number(u.balances.find((b) => b.symbol === symbol)?.amount ?? 0);
      const debit = Math.min(amount, bal);
      const shortfall = Math.max(0, amount - bal);
      debits.push({ symbol, debit, shortfall });
      if (debit > 0) recoverableUsd += await toUsd(debit, symbol);
      if (shortfall > 0) goneUsd += await toUsd(shortfall, symbol);
    }

    totalRecoverableUsd += recoverableUsd;
    totalGoneUsd += goneUsd;
    rows.push({ userId: u.id, email: u.email, username: u.username, debits, recoverableUsd, goneUsd });
  }

  return { accounts: rows, totalRecoverableUsd, totalGoneUsd };
}

export async function GET(req: Request) {
  const userId = await getUserId();
  if (!userId || !(await isAdmin(userId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const user = new URL(req.url).searchParams.get("user") ?? undefined;
  const result = await report(user);
  return NextResponse.json({
    mode: "dry-run",
    note: "Nothing was changed. POST to this URL with ?apply=1 to debit.",
    ...result,
  });
}

export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId || !(await isAdmin(userId))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const params = new URL(req.url).searchParams;
  const userFilter = params.get("user") ?? undefined;
  const apply = params.get("apply") === "1";

  const result = await report(userFilter);
  if (!apply) {
    return NextResponse.json({ mode: "dry-run", note: "Add ?apply=1 to actually debit.", ...result });
  }

  let applied = 0;
  for (const row of result.accounts) {
    await prisma.$transaction(async (tx) => {
      for (const d of row.debits) {
        if (!(d.debit > 0)) continue;
        await tx.balance.update({
          where: { userId_symbol: { userId: row.userId, symbol: d.symbol } },
          data: { amount: { decrement: d.debit } },
        });
        await tx.transaction.create({
          data: {
            userId: row.userId,
            type: "adjustment",
            status: "completed",
            assetIn: d.symbol,
            amountIn: new Prisma.Decimal(d.debit),
            counterparty: "Ttip",
            note: "Reversal of unfunded (test) credit",
            emoji: "⚖️",
            meta: {
              reason: "unfunded_credit_reversal",
              shortfall: d.shortfall,
              appliedAt: new Date().toISOString(),
            } as Prisma.InputJsonValue,
          },
        });
        applied++;
      }
    });
  }

  return NextResponse.json({ mode: "applied", debitsApplied: applied, ...result });
}
