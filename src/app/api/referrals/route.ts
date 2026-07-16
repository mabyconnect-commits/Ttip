import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { baseUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

export async function GET() {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return unauthorized();

    const referrals = await prisma.referral.findMany({
      where: { referrerId: userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    const base = baseUrl();
    return ok({
      code: user.referralCode,
      link: `${base}/join?ref=${user.referralCode}`,
      earned: Number(user.referralEarned),
      count: referrals.length,
      perReferral: 2000,
      referrals: referrals.map((r) => ({
        name: r.joinedName,
        bonus: Number(r.bonus),
        time: timeAgo(r.createdAt),
      })),
    });
  });
}
