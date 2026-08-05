import "server-only";
import { referenceRate } from "./rate";
import { quoteBuy, quoteSell } from "./pricing";
import { CRYPTO_ASSETS } from "./constants";

/**
 * Ttip's own live buy/sell rates for every asset the app lets someone hold.
 *
 * One definition, used by the rates screen AND by Ada. She was telling people
 * "I can't quote you a live ETH rate — I don't have one in front of me" while
 * the Rates screen two taps away showed it: the number existed, it just was
 * never handed to her. An assistant that can see your balance but not the price
 * of it can't answer the most common question anyone asks a wallet.
 *
 * The margin is baked into `buy`/`sell`; it is never itemised.
 */

export interface LiveRate {
  symbol: string;
  /** Fiat the user pays for 1 unit. */
  buy: number;
  /** Fiat the user receives for 1 unit. */
  sell: number;
}

/**
 * Cheap to call repeatedly: the P2P reference is cached per fiat for two
 * minutes and the price table for a minute, so this is arithmetic over two
 * fetches rather than one round trip per asset.
 *
 * An asset we can't price is LEFT OUT rather than published as zero. A missing
 * row makes a screen say "rate unavailable"; a zero row offers to sell somebody
 * ₦1,000 for nothing.
 */
export async function liveRates(fiat: string): Promise<LiveRate[]> {
  const rates = await Promise.all(
    CRYPTO_ASSETS.map(async ({ symbol }) => {
      const marketRate = await referenceRate(symbol, fiat).catch(() => 0);
      const buy = quoteBuy({ asset: symbol, fiat, amountAsset: 1, marketRate }).userRate;
      const sell = quoteSell({ asset: symbol, fiat, amountAsset: 1, marketRate }).userRate;
      return { symbol, buy, sell };
    }),
  );
  return rates.filter((r) => r.buy > 0 && r.sell > 0);
}
