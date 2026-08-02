import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { explorerTxUrl } from "@/lib/chains";

export const dynamic = "force-dynamic";

const INFLOW = new Set(["deposit", "ttip_in", "referral_bonus"]);

export async function GET(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const limit = Number(new URL(req.url).searchParams.get("limit") ?? 30);

    const txns = await prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 100),
    });

    return ok({
      transactions: txns.map((t) => {
        const inflow = INFLOW.has(t.type);
        const meta = (t.meta ?? {}) as { chainId?: number | string; txHash?: string };
        return {
          id: t.id,
          type: t.type,
          status: t.status,
          direction: inflow ? "in" : "out",
          assetIn: t.assetIn,
          amountIn: t.amountIn ? Number(t.amountIn) : null,
          assetOut: t.assetOut,
          amountOut: t.amountOut ? Number(t.amountOut) : null,
          counterparty: t.counterparty,
          note: t.note,
          emoji: t.emoji,
          explorerUrl: explorerTxUrl(meta.chainId, meta.txHash),
          time: timeAgo(t.createdAt),
          createdAt: t.createdAt,
        };
      }),
    });
  });
}
