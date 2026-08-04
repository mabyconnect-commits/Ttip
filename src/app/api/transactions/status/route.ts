import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized, ApiError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { refreshPayoutStatus } from "@/lib/settlement";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Where has my money got to?
 *
 * A live bank payout comes back "pending" — the provider has accepted it and
 * will confirm on its webhook a moment later. The receipt was a snapshot of
 * that instant, so it said "Processing" and then never changed its mind, even
 * once the money had landed. And if the webhook never arrived at all, the
 * transaction stayed pending for ever.
 *
 * So the receipt asks here while it's on screen. Two things happen: the
 * provider is re-queried for anything still pending (so a missing webhook stops
 * being fatal), and the current status is returned.
 *
 * Scoped to the signed-in user, and by our own reference — never by an id from
 * the client that could belong to someone else.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();

    const reference = new URL(req.url).searchParams.get("reference")?.trim();
    if (!reference) throw new ApiError("Missing reference", 400);

    // A receipt polls this every few seconds; that's the only intended caller.
    try {
      rateLimit(`txstatus:${userId}`, { limit: 60, windowMs: 60_000 });
    } catch {
      throw new ApiError("Slow down a moment.", 429);
    }

    // Settles it if the provider says it's done — this is what unsticks a
    // payout whose webhook never came.
    const settled = await refreshPayoutStatus(reference, userId).catch(() => null);

    const txn = await prisma.transaction.findFirst({
      where: { userId, meta: { path: ["reference"], equals: reference } },
      select: { status: true },
      orderBy: { createdAt: "desc" },
    });

    // The transaction is the record the rest of the app reads, so it wins when
    // both exist; the provider answer covers the moment before it's written.
    return ok({ status: txn?.status ?? settled ?? "pending" });
  });
}
