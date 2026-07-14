import { handler, ok } from "@/lib/api";
import { getPrices } from "@/lib/prices";
import { CRYPTO_ASSETS, FIAT_USD_RATE, FIATS } from "@/lib/constants";

export const dynamic = "force-dynamic";
export const revalidate = 60;

export async function GET() {
  return handler(async () => {
    const prices = await getPrices();

    // Build a ticker of common crypto/fiat pairs.
    const pairs: { pair: string; value: number; change: number; fiat: string }[] = [];
    const feature: [string, string][] = [
      ["BTC", "NGN"], ["USDT", "NGN"], ["ETH", "GHS"],
      ["USDT", "KES"], ["BTC", "ZAR"], ["SOL", "USD"],
    ];
    for (const [c, f] of feature) {
      const usd = prices[c]?.usd ?? 0;
      const value = usd / (FIAT_USD_RATE[f] ?? 1);
      pairs.push({ pair: `${c}/${f}`, value, change: prices[c]?.change24h ?? 0, fiat: f });
    }

    return ok({
      prices,
      pairs,
      fiatRates: FIAT_USD_RATE,
      fiats: FIATS,
      assets: CRYPTO_ASSETS.map((a) => ({ symbol: a.symbol, name: a.name, color: a.color, glyph: a.glyph })),
      updatedAt: Date.now(),
    });
  });
}
