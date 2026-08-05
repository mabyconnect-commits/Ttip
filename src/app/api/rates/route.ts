import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized } from "@/lib/api";
import { prisma } from "@/lib/db";
import { referenceRate } from "@/lib/rate";
import { quoteBuy, quoteSell } from "@/lib/pricing";
import { CRYPTO_ASSETS } from "@/lib/constants";

export const dynamic = "force-dynamic";

/**
 * Every asset the app lets someone hold — not a hand-picked six.
 *
 * This list used to be six symbols long while the swap screen offered all
 * fourteen, so picking TRX (or XRP, ADA, DOGE, MATIC, LTC, DOT, TON) produced
 * "1 NGN = 0 TRX" and a quote of zero. An asset you can pick is an asset we
 * must be able to price.
 *
 * Cheap to widen: the P2P reference is cached per fiat for two minutes and the
 * price table for a minute, so this is arithmetic over two fetches, not
 * fourteen.
 */
const RATE_ASSETS = CRYPTO_ASSETS.map((a) => a.symbol);

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

    // An asset we can't price is left out rather than published as zero. A
    // missing row makes the screen say "rate unavailable"; a zero row makes it
    // offer to sell somebody ₦1,000 for nothing.
    return ok({ fiat, rates: rates.filter((r) => r.buy > 0 && r.sell > 0) });
  });
}
