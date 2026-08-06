import { SWAP_FEE_PCT } from "./constants";

/**
 * Free swaps per user per day. NONE by default.
 *
 * This was 3, and it was a straight loss on every one: a free swap earns 0%
 * while still accruing cashback on its volume, so the platform paid the
 * user to trade. Every swap is now priced.
 *
 * Kept configurable so a promo can be run deliberately — set FREE_SWAPS_PER_DAY
 * for a limited period — rather than being a permanent giveaway nobody costed.
 */
export const FREE_SWAPS_PER_DAY = (() => {
  const v = Number(process.env.FREE_SWAPS_PER_DAY);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
})();

/**
 * How many free swaps a user has today. The stored counter only applies to the
 * stored day; on any new calendar day the full daily allowance is restored.
 *
 * Clamped to the current allowance so lowering it takes effect immediately —
 * otherwise everyone who had banked 3 today would keep them.
 */
export function freeSwapsLeft(storedDay: string | null, storedLeft: number, today: string): number {
  if (storedDay !== today) return FREE_SWAPS_PER_DAY;
  return Math.min(Math.max(0, storedLeft), FREE_SWAPS_PER_DAY);
}

export interface SwapQuote {
  /** Fee fraction applied (0 while free swaps remain). */
  feePct: number;
  /** Whether this swap consumed a free-swap allowance. */
  free: boolean;
  /** Output amount after fee. */
  net: number;
  /** Effective rate: net output per unit of input. */
  rate: number;
}

/**
 * Pure swap pricing: given the gross converted output and how many free swaps
 * remain, return the fee, net output and effective rate. This is the single
 * source of truth for swap economics — the API route and tests both use it.
 */
export function quoteSwap(amountIn: number, gross: number, freeLeft: number): SwapQuote {
  const free = freeLeft > 0;
  const feePct = free ? 0 : SWAP_FEE_PCT;
  const net = gross * (1 - feePct);
  const rate = amountIn > 0 ? net / amountIn : 0;
  return { feePct, free, net, rate };
}
