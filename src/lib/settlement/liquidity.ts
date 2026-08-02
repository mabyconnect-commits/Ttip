import "server-only";
import crypto from "crypto";
import { convert } from "../prices";

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

export function liquidityProvider(): LiquidityProvider {
  // Only the sandbox venue is built in; real venues register here by name.
  return sandboxLiquidity;
}
