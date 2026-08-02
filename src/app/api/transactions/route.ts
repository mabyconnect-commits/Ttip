import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { explorerTxUrl } from "@/lib/chains";

export const dynamic = "force-dynamic";

// Transactions where crypto/value lands in the user's wallet — shown as a green
// "+asset received". A buy is an on-ramp: the user acquires crypto (assetOut),
// so it reads like a deposit (+USDT), not the naira spent (−₦).
const INFLOW = new Set(["deposit", "ttip_in", "referral_bonus", "buy"]);

export async function GET(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const params = new URL(req.url).searchParams;
    const limit = Number(params.get("limit") ?? 30);

    // The cashback view asks for its own records; every other view hides the
    // per-trade cashback-earn rows so the main history stays clean.
    const where =
      params.get("type") === "cashback"
        ? { userId, type: { in: ["cashback_earn", "cashback"] } }
        : { userId, type: { not: "cashback_earn" } };

    const txns = await prisma.transaction.findMany({
      where,
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
