import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Referral leaderboard — top referrers ranked by earnings, for the all-time,
 * this-month or this-week window, plus where the current user sits. Earnings are
 * summed from the permanent `referral_bonus` transactions so ranks reflect real,
 * paid revenue share.
 *
 *   /api/referrals/leaderboard?period=all|month|week
 */
export async function GET(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();

    const period = new URL(req.url).searchParams.get("period") || "all";
    const now = Date.now();
    const since =
      period === "week" ? new Date(now - 7 * 24 * 3600_000)
      : period === "month" ? new Date(now - 30 * 24 * 3600_000)
      : undefined;

    const where = { type: "referral_bonus", status: "completed", ...(since ? { createdAt: { gte: since } } : {}) };

    // Rank every referrer by summed earnings in the window.
    const grouped = await prisma.transaction.groupBy({
      by: ["userId"],
      where,
      _sum: { amountOut: true },
      orderBy: { _sum: { amountOut: "desc" } },
      take: 100,
    });

    const ids = grouped.map((g) => g.userId);
    const [users, refCounts] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, username: true } }),
      prisma.referral.groupBy({ by: ["referrerId"], where: { referrerId: { in: ids } }, _count: { _all: true } }),
    ]);
    const nameById = new Map(users.map((u) => [u.id, u.name || u.username || "Ttiper"]));
    const countById = new Map(refCounts.map((r) => [r.referrerId, r._count._all]));

    const rows = grouped.map((g, i) => ({
      rank: i + 1,
      name: (nameById.get(g.userId) ?? "Ttiper").split(" ")[0],
      referrals: countById.get(g.userId) ?? 0,
      earned: Number(g._sum.amountOut ?? 0),
      isYou: g.userId === userId,
    }));

    // Where the current user sits (even if outside the top 100).
    const meRow = rows.find((r) => r.isYou);
    let you = meRow ?? null;
    if (!you) {
      const mine = await prisma.transaction.aggregate({ where: { ...where, userId }, _sum: { amountOut: true } });
      const earned = Number(mine._sum.amountOut ?? 0);
      you = { rank: 0, name: "You", referrals: 0, earned, isYou: true };
    }

    return ok({ period, leaders: rows, you });
  });
}
