import { SWAP_FEE_PCT } from "./constants";

export const FREE_SWAPS_PER_DAY = 3;

/**
 * How many free swaps a user has today. The stored counter only applies to the
 * stored day; on any new calendar day the full daily allowance is restored.
 */
export function freeSwapsLeft(storedDay: string | null, storedLeft: number, today: string): number {
  return storedDay !== today ? FREE_SWAPS_PER_DAY : storedLeft;
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
