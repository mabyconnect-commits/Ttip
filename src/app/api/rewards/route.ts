import { z } from "zod";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized, ApiError } from "@/lib/api";
import { getAppState } from "@/lib/serialize";

export const dynamic = "force-dynamic";

const DROP_POINTS = 50;
const DROP_COOLDOWN_MS = 20 * 60 * 60 * 1000; // ~once a day

// Quests are derived from real account activity.
export async function GET() {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return unauthorized();

    const [swaps, tips, bills] = await Promise.all([
      prisma.transaction.count({ where: { userId, type: "swap" } }),
      prisma.transaction.count({ where: { userId, type: "ttip_out" } }),
      prisma.transaction.count({ where: { userId, type: "bill" } }),
    ]);

    const quests = [
      { id: "swap3", title: "Swap 3 times", reward: 150, icon: "⇄", progress: Math.min(swaps, 3), goal: 3 },
      { id: "tip5", title: "Send 5 Ttips", reward: 250, icon: "⚡", progress: Math.min(tips, 5), goal: 5 },
      { id: "bill1", title: "Pay a bill from crypto", reward: 80, icon: "📱", progress: Math.min(bills, 1), goal: 1 },
      { id: "verify", title: "Verify your identity", reward: 500, icon: "🛡️", progress: user.kycStatus === "verified" ? 1 : 0, goal: 1 },
    ];

    const canDrop = !user.lastDropAt || Date.now() - new Date(user.lastDropAt).getTime() > DROP_COOLDOWN_MS;
    return ok({ quests, points: user.points, canDrop, dropPoints: DROP_POINTS });
  });
}

const schema = z.object({ action: z.enum(["daily"]) });

// Claim the daily points drop.
export async function POST(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    schema.parse(await req.json());
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return unauthorized();

    if (user.lastDropAt && Date.now() - new Date(user.lastDropAt).getTime() < DROP_COOLDOWN_MS) {
      throw new ApiError("You've already claimed today's drop — come back tomorrow", 400);
    }
    await prisma.user.update({
      where: { id: userId },
      data: { points: { increment: DROP_POINTS }, lastDropAt: new Date() },
    });
    const state = await getAppState(userId);
    return ok({ ...state, awarded: DROP_POINTS });
  });
}
