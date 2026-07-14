import { z } from "zod";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized } from "@/lib/api";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function GET() {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();

    const items = await prisma.feedItem.findMany({
      orderBy: { createdAt: "desc" },
      take: 40,
      include: { actor: { select: { avatarGradient: true, username: true } } },
    });

    const feed = items.map((it) => ({
      id: it.id,
      kind: it.kind,
      actorName: it.actorName,
      targetName: it.targetName,
      amount: it.amount ? Number(it.amount) : null,
      currency: it.currency,
      note: it.note,
      emoji: it.emoji,
      reactions: (it.reactions as Record<string, number>) ?? {},
      gradient: it.actor.avatarGradient,
      initial: it.actorName.replace(/^@/, "").charAt(0).toUpperCase(),
      time: timeAgo(it.createdAt),
    }));

    // Weekly league (top tippers by total ttip_out this week)
    const since = new Date(Date.now() - 7 * 864e5);
    const league = await prisma.transaction.groupBy({
      by: ["userId"],
      where: { type: "ttip_out", createdAt: { gte: since } },
      _sum: { amountOut: true },
      orderBy: { _sum: { amountOut: "desc" } },
      take: 10,
    });
    const users = await prisma.user.findMany({
      where: { id: { in: league.map((l) => l.userId) } },
      select: { id: true, username: true, avatarGradient: true },
    });
    const umap = Object.fromEntries(users.map((u) => [u.id, u]));
    const leaderboard = league.map((l, i) => ({
      rank: i + 1,
      username: "@" + (umap[l.userId]?.username ?? "user"),
      gradient: umap[l.userId]?.avatarGradient ?? "135deg,#6D5BFF,#2AC8FF",
      total: Number(l._sum.amountOut ?? 0),
      isYou: l.userId === userId,
    }));

    return ok({ feed, leaderboard });
  });
}

const react = z.object({ id: z.string(), emoji: z.string().max(8) });

export async function POST(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const { id, emoji } = react.parse(await req.json());
    const item = await prisma.feedItem.findUnique({ where: { id } });
    if (!item) return ok({ ok: false });
    const reactions = { ...((item.reactions as Record<string, number>) ?? {}) };
    reactions[emoji] = (reactions[emoji] ?? 0) + 1;
    await prisma.feedItem.update({ where: { id }, data: { reactions } });
    return ok({ ok: true, reactions });
  });
}
