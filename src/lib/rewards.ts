import "server-only";
import { convert } from "./prices";
import { REWARDS_BASE_FIAT } from "./constants";

/**
 * Currency handling for the reward pots (`user.cashback`, `user.referralEarned`).
 *
 * Both are bare Decimals with no currency column, so they are denominated in
 * `REWARDS_BASE_FIAT` and nothing else. Every boundary converts: earnings are
 * converted INTO the base before they hit a pot, and a claim/withdrawal converts
 * OUT of the base at the live rate.
 *
 * Skipping that conversion is a treasury drain, not a display bug: the pot would
 * simply be re-labelled when the user switches currency, so a ₦6,908 pot claimed
 * on ZAR paid R6,908 — about 82x its real value.
 */

export { REWARDS_BASE_FIAT };

/**
 * Live value of one unit of the base fiat in `fiat` (1 when it is the base).
 * Returns 0 if the rate can't be resolved — callers must treat that as "can't
 * price this right now" and refuse, never as a free pass to skip conversion.
 */
export async function rewardsRate(fiat: string): Promise<number> {
  if (!fiat || fiat === REWARDS_BASE_FIAT) return 1;
  const rate = await convert(1, REWARDS_BASE_FIAT, fiat);
  return Number.isFinite(rate) && rate > 0 ? rate : 0;
}

/** Convert an amount denominated in `fiat` into the rewards base currency. */
export async function toRewardsBase(amount: number, fiat: string): Promise<number> {
  if (!(amount > 0)) return 0;
  if (!fiat || fiat === REWARDS_BASE_FIAT) return amount;
  const base = await convert(amount, fiat, REWARDS_BASE_FIAT);
  return Number.isFinite(base) && base > 0 ? base : 0;
}
