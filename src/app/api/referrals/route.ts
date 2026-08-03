import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { baseUrl } from "@/lib/url";
import { referralEarnPct, depositBonusHoldHours } from "@/lib/referral";
import { DEPOSIT_BONUS_NGN, DEPOSIT_BONUS_MIN_USD } from "@/lib/constants";

export const dynamic = "force-dynamic";

export async function GET() {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return unauthorized();

    const [referrals, earnings, count, verifiedCount] = await Promise.all([
      prisma.referral.findMany({ where: { referrerId: userId }, orderBy: { createdAt: "desc" }, take: 50 }),
      // Every referral earning credited to this user (signup bonus + fee share).
      prisma.transaction.findMany({
        where: { userId, type: "referral_bonus" },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      // Counted off the users themselves, not the 50-row referral list above —
      // someone with 60 referrals was being shown 50.
      prisma.user.count({ where: { referredById: userId } }),
      // The ones who finished KYC. These are the friends who can actually trade,
      // so they're the ones who earn the referrer anything.
      prisma.user.count({ where: { referredById: userId, kycStatus: "verified" } }),
    ]);

    const now = Date.now();
    const WEEK = new Date(now - 7 * 24 * 3600_000);
    const MONTH = new Date(now - 30 * 24 * 3600_000);
    const base_where = { userId, type: "referral_bonus", status: "completed" };
    // All-time / windowed earnings from the permanent earning records, so the
    // totals are exact regardless of how many rows there are.
    const [allTime, week, month] = await Promise.all([
      prisma.transaction.aggregate({ where: base_where, _sum: { amountOut: true } }),
      prisma.transaction.aggregate({ where: { ...base_where, createdAt: { gte: WEEK } }, _sum: { amountOut: true } }),
      prisma.transaction.aggregate({ where: { ...base_where, createdAt: { gte: MONTH } }, _sum: { amountOut: true } }),
    ]);
    const thisWeek = Number(week._sum.amountOut ?? 0);
    const thisMonth = Number(month._sum.amountOut ?? 0);

    const base = baseUrl();
    return ok({
      code: user.referralCode,
      link: `${base}/join?ref=${user.referralCode}`,
      // Total earned = all-time; balance = the claimable, not-yet-withdrawn pot.
      earned: Number(allTime._sum.amountOut ?? 0),
      balance: Number(user.referralEarned),
      count,
      verifiedCount,
      earnPct: referralEarnPct(), // e.g. 0.25
      depositBonus: DEPOSIT_BONUS_NGN, // ₦ paid to a referral on their first deposit
      depositBonusMinUsd: DEPOSIT_BONUS_MIN_USD,
      depositBonusHoldHours: depositBonusHoldHours(),
      thisWeek,
      thisMonth,
      // Earning entries — who generated it and how much.
      earnings: earnings.map((e) => ({
        name: e.counterparty ?? "Referral",
        amount: Number(e.amountOut ?? 0),
        note: e.note ?? "Referral earning",
        time: timeAgo(e.createdAt),
      })),
      referrals: referrals.map((r) => ({
        name: r.joinedName,
        bonus: Number(r.bonus),
        time: timeAgo(r.createdAt),
      })),
    });
  });
}
