/**
 * Netting engine.
 *
 * At volume you have users off-ramping (sell crypto → fiat) *and* on-ramping
 * (fiat → buy crypto). Matching those opposing flows internally means you only
 * take the **net** imbalance to the market — matched volume pays zero external
 * spread while you still earn margin on both sides. This is the single biggest
 * lever on effective rate.
 *
 * The math is pure and tested here; the live inputs (gross buy/sell demand over
 * a window) come from the order/settlement flow via nettableBuyDemand(), which
 * returns 0 until an on-ramp/buy flow exists — at which point netting kicks in
 * with no change to callers.
 */

export interface NettingResult {
  /** Amount matched internally (no external execution, no external spread). */
  matched: number;
  /** Net amount to sell on the market after matching. */
  externalSell: number;
  /** Net amount to buy on the market after matching. */
  externalBuy: number;
}

/** Net gross sell demand against gross buy demand for the same asset. */
export function computeNetting(grossSell: number, grossBuy: number): NettingResult {
  const sell = Math.max(0, grossSell);
  const buy = Math.max(0, grossBuy);
  const matched = Math.min(sell, buy);
  return {
    matched,
    externalSell: Math.max(0, sell - buy),
    externalBuy: Math.max(0, buy - sell),
  };
}

/**
 * How much of a desired sell (liquidation) can be covered by internal buy
 * demand, so only the remainder is liquidated externally.
 */
export function nettedSellAmount(desiredSell: number, availableBuyDemand: number): number {
  return Math.max(0, desiredSell - Math.max(0, availableBuyDemand));
}

/**
 * Live buy-side (on-ramp) demand available to net against, per asset. Returns 0
 * today — Ttip has no fiat→crypto on-ramp order flow yet. Wire this to pending
 * on-ramp orders when that flow exists and netting takes effect automatically.
 */
export async function nettableBuyDemand(_asset: string): Promise<number> {
  return 0;
}
