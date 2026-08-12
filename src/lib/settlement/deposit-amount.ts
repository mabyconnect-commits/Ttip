import "server-only";
import { tokenDecimals } from "./dextopus";
import type { NormalizedDeposit } from "./types";

/**
 * Turning a base-unit figure into money.
 *
 * Dextopus reports settlement amounts in BASE UNITS — the same convention the
 * Sweepflow reference implementation follows, where every displayed figure goes
 * through `formatAmount(raw, decimals)`. We were crediting the base-unit integer
 * directly whenever the provider omitted its "…Formatted" field, which is why
 * 0.725902 USDC arrived as 725,902 and 10.29 USDT as ten quintillion. Same bug,
 * wildly different magnitudes, because the multiplier is the token's decimals.
 *
 * Two rules, both learned the hard way:
 *
 *  1. DIVIDE WITH BigInt. 10290000000000000000 is far past the largest integer
 *     a JS number holds exactly, so any arithmetic on it as a number is already
 *     wrong before the decimals are applied.
 *
 *  2. UNKNOWN DECIMALS MEANS DO NOT CREDIT. Assuming 6 where the answer is 18 is
 *     an error of a factor of a trillion. A deposit we can't scale is one to
 *     hold, never one to estimate.
 */

/** Base units → tokens, exactly, for values of any size. */
export function scaleUnits(raw: string, decimals: number): number | null {
  let big: bigint;
  try {
    big = BigInt(raw.trim());
  } catch {
    return null;
  }
  if (big <= 0n || decimals < 0 || decimals > 36) return null;
  if (decimals === 0) return Number(big);

  const divisor = 10n ** BigInt(decimals);
  const whole = big / divisor;
  const fraction = big % divisor;
  // Assembled as a decimal string, then parsed once — so the only rounding is
  // the single conversion at the end, not a chain of divisions.
  const text = `${whole}.${fraction.toString().padStart(decimals, "0")}`;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export interface ScaleOutcome {
  /** The deposit with `amount` in tokens. Absent when it can't be scaled. */
  deposit?: NormalizedDeposit;
  /** Why it couldn't be, for the log and the operator. */
  reason?: string;
}

/**
 * Make a parsed deposit safe to credit.
 *
 * A deposit whose amount was already formatted passes straight through. One
 * carrying base units is scaled by the decimals the PROVIDER reports for that
 * token — asked of their catalogue rather than a table we maintain, because the
 * same ticker differs by chain and a stale table is how this goes wrong quietly.
 */
export async function scaleDepositAmount(deposit: NormalizedDeposit): Promise<ScaleOutcome> {
  if (!deposit.amountIsRaw) return { deposit };

  const raw = deposit.rawAmount;
  if (!raw) return { reason: "marked as base units but no raw figure was captured" };

  const decimals = await tokenDecimals(deposit.asset, deposit.chainId).catch(() => null);
  if (decimals == null) {
    return { reason: `no decimals known for ${deposit.asset} on chain ${deposit.chainId ?? deposit.chain}` };
  }

  const scaled = scaleUnits(raw, decimals);
  if (scaled == null) return { reason: `could not scale ${raw} by 10^${decimals}` };

  return { deposit: { ...deposit, amount: scaled, amountIsRaw: false } };
}
