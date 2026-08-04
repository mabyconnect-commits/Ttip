import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";

/**
 * How many people are actually on Ttip.
 *
 * A single "total users" number flatters you — it counts everyone who ever
 * typed an email in. The numbers that decide anything are how many verified,
 * how many put real money in, and how many did something in the last week. So
 * the total is here, and so is the funnel underneath it.
 *
 * "Funded" means a payment provider actually settled money in. Signup bonuses
 * and platform credit create balances out of nothing, so counting a balance
 * would count people who never sent a naira.
 */

export const dynamic = "force-dynamic";

const REAL_PROVIDERS = ["dextopus", "flutterwave", "paystack", "monnify", "coralpay"];

async function isAdmin(userId: string): Promise<boolean> {
  const raw = process.env.ADMIN_EMAILS ?? process.env.ADMIN_MAILS ?? "";
  const admins = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!admins.length) return false;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return !!user && admins.includes(user.email.toLowerCase());
}

export async function GET() {
  const userId = await getUserId();
  if (!userId || !(await isAdmin(userId))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const now = Date.now();
  const since = (days: number) => new Date(now - days * 864e5);

  const [total, verified, pending, withNairaAccount, withPin, newToday, new7d, new30d] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { kycStatus: "verified" } }),
    prisma.user.count({ where: { kycStatus: "pending" } }),
    prisma.user.count({ where: { nairaAccount: { not: null } } }),
    prisma.user.count({ where: { pinHash: { not: null } } }),
    prisma.user.count({ where: { createdAt: { gte: since(1) } } }),
    prisma.user.count({ where: { createdAt: { gte: since(7) } } }),
    prisma.user.count({ where: { createdAt: { gte: since(30) } } }),
  ]);

  // Funded = a provider actually settled money in. Counted distinctly, because
  // one person with ten deposits is still one funded user.
  const fundedRows = await prisma.settlement.findMany({
    where: { status: "completed", kind: { in: ["deposit", "buy"] }, provider: { in: REAL_PROVIDERS }, userId: { not: null } },
    select: { userId: true },
    distinct: ["userId"],
  });

  // Active = did something, not just logged in.
  const activeRows = await prisma.transaction.findMany({
    where: { createdAt: { gte: since(30) }, status: { in: ["completed", "pending"] } },
    select: { userId: true, createdAt: true },
  });
  const active7 = new Set(activeRows.filter((r) => r.createdAt >= since(7)).map((r) => r.userId));
  const active30 = new Set(activeRows.map((r) => r.userId));

  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);

  return NextResponse.json({
    total,
    signups: { today: newToday, last7d: new7d, last30d: new30d },
    funnel: {
      verified,
      verifiedPct: pct(verified),
      pendingVerification: pending,
      funded: fundedRows.length,
      fundedPct: pct(fundedRows.length),
      withNairaAccount,
      withPin,
    },
    active: { last7d: active7.size, last30d: active30.size, last7dPct: pct(active7.size) },
    note: "Funded counts users a payment provider actually settled money for — never a balance, which the platform can create.",
  });
}
