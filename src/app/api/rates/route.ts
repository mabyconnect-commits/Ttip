import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized } from "@/lib/api";
import { prisma } from "@/lib/db";
import { liveRates } from "@/lib/live-rates";

export const dynamic = "force-dynamic";

/**
 * Ttip's live buy/sell rates — the real prices we charge (market ± our margin),
 * built on the live P2P reference. The margin is baked into the numbers; it is
 * never itemised. This is what makes our rate our rate.
 *
 * The table itself lives in lib/live-rates.ts because Ada quotes from the same
 * one: two answers to "what is ETH worth" is how an assistant contradicts the
 * screen the user is looking at.
 */
export async function GET(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { defaultFiat: true } });
    const fiat = new URL(req.url).searchParams.get("fiat") || user?.defaultFiat || "NGN";

    return ok({ fiat, rates: await liveRates(fiat) });
  });
}
