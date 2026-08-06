import "server-only";
import crypto from "crypto";
import { convert } from "../prices";
import { isLive } from "./config";

/**
 * Liquidity engine — turns treasury crypto into fiat float so payouts stay
 * instant even when the float alone can't cover a large withdrawal.
 *
 * Provider-agnostic: the sandbox provider clears at the live reference rate, and
 * a real venue (an exchange spot API, an OTC desk, or a P2P-merchant bot) plugs
 * in behind the same interface. In production you'd also net internal buy/sell
 * flow first (see nettableFlow) and only externalize the remainder.
 */

export interface LiquidationQuote {
  provider: string;
  asset: string; // crypto sold, e.g. USDT
  fiat: string; // fiat received, e.g. NGN
  amountAsset: number; // crypto to sell
  rate: number; // fiat per 1 unit of asset (reference)
  amountFiat: number; // fiat obtained
  expiresAt: number;
}

export interface LiquidationResult {
  ref: string;
  amountFiat: number;
}

export interface LiquidityProvider {
  name: string;
  quote(asset: string, fiat: string, amountAsset: number): Promise<LiquidationQuote>;
  execute(quote: LiquidationQuote): Promise<LiquidationResult>;
}

/** Sandbox venue: clears at the live market rate with no external settlement. */
const sandboxLiquidity: LiquidityProvider = {
  name: "sandbox",
  async quote(asset, fiat, amountAsset) {
    const amountFiat = await convert(amountAsset, asset, fiat);
    const rate = amountAsset > 0 ? amountFiat / amountAsset : 0;
    return { provider: "sandbox", asset, fiat, amountAsset, rate, amountFiat, expiresAt: Date.now() + 30_000 };
  },
  async execute(quote) {
    return { ref: "liq_" + crypto.randomUUID(), amountFiat: quote.amountFiat };
  },
};

/**
 * The venue, or null when there isn't one that can actually trade.
 *
 * Null is the important case, and it used to be impossible. The sandbox venue
 * "executes" instantly at the reference rate and credits the float with naira
 * that does not exist — harmless on a test deployment, and on a live one it
 * means every shortfall silently disappears into imaginary money. ensureFloat
 * would report no shortfall, the payout would be sent against a float that
 * wasn't there, and the provider would reject it.
 *
 * So on a live deployment there is NO instant venue. A shortfall stays a
 * shortfall, the payout is held, and treasury USDC goes to a real exchange to
 * be really sold (see float.ts). Fake float is worse than no float: it hides
 * the one number an operator needs.
 */
export function liquidityProvider(): LiquidityProvider | null {
  return isLive() ? null : sandboxLiquidity;
}
