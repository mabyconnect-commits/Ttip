import { convert } from "./prices";

/**
 * Market reference rate for crypto↔fiat.
 *
 * Official FX (from prices.ts) sits below the Nigerian P2P/parallel rate, so we
 * apply a configurable **P2P premium** on top to track what users actually get
 * on Bybit P2P. Set it globally with `P2P_PREMIUM_PCT` or per-currency with
 * `P2P_PREMIUM_<CODE>` (e.g. P2P_PREMIUM_NGN=0.03 for +3%). Default 0.
 *
 * This is the seam for a live feed: swap `officialFiat()` for a real Bybit-P2P /
 * aggregator source and every quote tracks it, with the rest of the engine
 * unchanged.
 */

/** The P2P premium for a fiat, as a fraction (0 = use official rate as-is). */
export function p2pPremium(fiat: string): number {
  const per = Number(process.env[`P2P_PREMIUM_${fiat.toUpperCase()}`]);
  if (Number.isFinite(per) && per >= 0) return per;
  const global = Number(process.env.P2P_PREMIUM_PCT);
  return Number.isFinite(global) && global >= 0 ? global : 0;
}

/** Fiat value of `amount` crypto at the P2P reference. */
export async function referenceFiat(amount: number, asset: string, fiat: string): Promise<number> {
  const official = await convert(amount, asset, fiat);
  return official * (1 + p2pPremium(fiat));
}

/** P2P reference: fiat per 1 unit of the asset. */
export async function referenceRate(asset: string, fiat: string): Promise<number> {
  return referenceFiat(1, asset, fiat);
}
