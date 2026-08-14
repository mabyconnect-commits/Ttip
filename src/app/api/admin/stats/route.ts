import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { toUsd, getFiatRates } from "@/lib/prices";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The growth numbers, in naira, on one screen.
 *
 * The admin page could already tell you how much Ttip EARNED and how much was
 * unbacked — the accountant's questions. It could not tell you whether the
 * thing is growing: how many people opened it today, how many came back, how
 * much moved this week. Those are the numbers you actually show someone.
 *
 * Reported in naira rather than dollars because that is the currency the
 * business is quoted in, and a Nigerian operator should not have to convert a
 * headline figure in their head.
 */

async function isAdmin(userId: string): Promise<boolean> {
  const admins = (process.env.ADMIN_EMAILS ?? process.env.ADMIN_MAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!admins.length) return false;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return !!user?.email && admins.includes(user.email.toLowerCase());
}

/**
 * Midnight in Lagos, not midnight in UTC.
 *
 * "Today" on a dashboard read by someone in Lagos has to mean their today. UTC
 * midnight falls at 1am local, so an hour of every night would be counted
 * against the wrong day — and at 00:30 the "today" tile would read zero while
 * the app was plainly in use.
 */
function startOfLagosDay(daysAgo = 0): Date {
  const shifted = new Date(Date.now() + 3_600_000 - daysAgo * 864e5);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - 3_600_000);
}

/**
 * One mis-credited row must not eat the dashboard.
 *
 * A deposit written in raw base units once made total volume read
 * $10,281,099,150,000,038,000, which made every other number on the page
 * meaningless. Anything above the cap is left out and counted, so the figure
 * stays readable and the operator is told it was incomplete.
 */
function sanityCapUsd(): number {
  const raw = (process.env.ADMIN_MAX_TXN_USD ?? "").trim();
  const n = Number(raw);
  return raw !== "" && Number.isFinite(n) && n > 0 ? n : 10_000_000;
}

export async function GET() {
  const me = await getUserId();
  if (!me || !(await isAdmin(me))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const today = startOfLagosDay();
  const d7 = new Date(Date.now() - 7 * 864e5);
  const d30 = new Date(Date.now() - 30 * 864e5);

  const [
    total,
    newToday,
    new7d,
    new30d,
    recurring,
    verified,
    withPin,
    seenToday,
    seen7d,
    seen30d,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: today } } }),
    prisma.user.count({ where: { createdAt: { gte: d7 } } }),
    prisma.user.count({ where: { createdAt: { gte: d30 } } }),
    prisma.user.count({ where: { streakDays: { gte: 2 } } }),
    prisma.user.count({ where: { kycStatus: "verified" } }),
    prisma.user.count({ where: { pinHash: { not: null } } }),
    prisma.user.count({ where: { lastSeenAt: { gte: today } } }),
    prisma.user.count({ where: { lastSeenAt: { gte: d7 } } }),
    prisma.user.count({ where: { lastSeenAt: { gte: d30 } } }),
  ]);

  // Every completed transaction, once. Volume is the larger of the two sides:
  // a swap that turns $100 of USDT into $99.60 of SOL moved $100, and counting
  // both sides would double it.
  const txns = await prisma.transaction.findMany({
    where: { status: "completed" },
    select: { type: true, assetIn: true, amountIn: true, assetOut: true, amountOut: true, createdAt: true, userId: true },
  });

  const rates = await getFiatRates();
  const usdPerNgn = rates.NGN ?? 0;
  const cap = sanityCapUsd();
  const unit = new Map<string, number>();
  const priceOf = async (symbol: string): Promise<number> => {
    let u = unit.get(symbol);
    if (u === undefined) {
      u = await toUsd(1, symbol).catch(() => 0);
      unit.set(symbol, u);
    }
    return u;
  };

  let allTimeUsd = 0;
  let usd7d = 0;
  let usd30d = 0;
  let usdToday = 0;
  let tx7d = 0;
  let tx30d = 0;
  let txToday = 0;
  let excluded = 0;
  const byType: Record<string, { count: number; usd: number }> = {};
  const activeTxToday = new Set<string>();

  for (const t of txns) {
    const outUsd = (Number(t.amountOut ?? 0) || 0) * (t.assetOut ? await priceOf(t.assetOut) : 0);
    const inUsd = (Number(t.amountIn ?? 0) || 0) * (t.assetIn ? await priceOf(t.assetIn) : 0);
    const value = Math.max(outUsd, inUsd);
    if (!Number.isFinite(value) || value > cap) {
      excluded++;
      continue;
    }

    allTimeUsd += value;
    const bucket = (byType[t.type] ??= { count: 0, usd: 0 });
    bucket.count++;
    bucket.usd += value;

    if (t.createdAt >= d30) {
      usd30d += value;
      tx30d++;
    }
    if (t.createdAt >= d7) {
      usd7d += value;
      tx7d++;
    }
    if (t.createdAt >= today) {
      usdToday += value;
      txToday++;
      activeTxToday.add(t.userId);
    }
  }

  // Naira, from dollars. A rate of zero would divide to Infinity, so an FX
  // outage reports nothing rather than nonsense.
  const ngn = (v: number) => (usdPerNgn > 0 ? v / usdPerNgn : 0);
  const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 1000) / 10 : 0);

  // lastSeenAt only starts filling from the day it shipped, so until it has
  // history, someone who transacted today plainly opened the app today.
  const activeToday = Math.max(seenToday, activeTxToday.size);

  const flows = Object.fromEntries(
    Object.entries(byType).map(([type, v]) => [type, { count: v.count, ngn: Math.round(ngn(v.usd)) }]),
  );

  return NextResponse.json({
    fiat: "NGN",
    users: {
      total,
      newToday,
      new7d,
      new30d,
      recurring,
      verified,
      withPin,
      verifiedPct: pct(verified, total),
    },
    active: {
      today: activeToday,
      last7d: seen7d,
      last30d: seen30d,
      todayPct: pct(activeToday, total),
      // Of everyone who signed up in the last 30 days, how many are still
      // opening it? The single number that says whether Ttip is sticky.
      retention7dPct: pct(seen7d, new30d || total),
      tracking: seen30d > 0,
    },
    volume: {
      allTimeNgn: Math.round(ngn(allTimeUsd)),
      allTimeTx: txns.length - excluded,
      todayNgn: Math.round(ngn(usdToday)),
      todayTx: txToday,
      last7dNgn: Math.round(ngn(usd7d)),
      last7dTx: tx7d,
      last30dNgn: Math.round(ngn(usd30d)),
      last30dTx: tx30d,
      avgTxNgn: tx30d > 0 ? Math.round(ngn(usd30d) / tx30d) : 0,
    },
    flows,
    excluded,
  });
}
