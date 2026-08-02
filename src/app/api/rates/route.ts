import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized } from "@/lib/api";
import { prisma } from "@/lib/db";
import { referenceRate } from "@/lib/rate";
import { quoteBuy, quoteSell } from "@/lib/pricing";

export const dynamic = "force-dynamic";

const RATE_ASSETS = ["USDT", "USDC", "BTC", "ETH", "SOL", "BNB"];

/**
 * Ttip's live buy/sell rates — the real prices we charge (market ± our margin),
 * built on the live P2P reference. The margin is baked into the numbers; it is
 * never itemised. This is what makes our rate our rate.
 */
export async function GET(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { defaultFiat: true } });
    const fiat = new URL(req.url).searchParams.get("fiat") || user?.defaultFiat || "NGN";

    const rates = await Promise.all(
      RATE_ASSETS.map(async (symbol) => {
        const marketRate = await referenceRate(symbol, fiat);
        const buy = quoteBuy({ asset: symbol, fiat, amountAsset: 1, marketRate }).userRate;
        const sell = quoteSell({ asset: symbol, fiat, amountAsset: 1, marketRate }).userRate;
        return { symbol, buy, sell };
      }),
    );

    return ok({ fiat, rates });
  });
}
