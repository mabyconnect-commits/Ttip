/**
 * Work out which wallets pay for a withdrawal.
 *
 * People hold a bit of everything — $10 of USDT, $15 of SOL, ₦25,000 — and then
 * want to send ₦50,000. Refusing because no single wallet covers it is the app
 * being unhelpful about money the user demonstrably has. This spreads the debit
 * across whatever they hold.
 *
 * Order is deliberate, and it's the order that costs the user least:
 *
 *   1. The wallet they picked — honour the explicit choice first.
 *   2. The payout currency itself — naira out of naira carries no spread at
 *      all, so spending it saves them the ~1.8% conversion.
 *   3. Everything else, largest first — fewest legs, so the fewest conversions.
 *
 * Pure and dependency-free: no prices are fetched here, the caller passes the
 * rate each asset converts at. That keeps it exactly testable, which matters
 * because getting it wrong debits the wrong wallet.
 */

export interface FundingSource {
  symbol: string;
  /** Units held. */
  amount: number;
  /** Fiat the USER receives per unit — the sell rate for crypto, 1 for the payout fiat. */
  fiatPerUnit: number;
}

export interface FundingLeg {
  symbol: string;
  /** Units to debit from this wallet. */
  take: number;
  /** Fiat that leg raises. */
  fiat: number;
}

export interface FundingPlan {
  /** True when the legs cover the target. */
  ok: boolean;
  legs: FundingLeg[];
  /** Fiat the legs raise. */
  raised: number;
  /** Fiat still missing when `ok` is false. */
  short: number;
}

// Money comparisons need a tolerance, or floating point leaves a plan a
// billionth of a naira short and refuses a withdrawal the user can afford.
const EPS = 1e-6;

export function planFunding(
  targetFiat: number,
  sources: readonly FundingSource[],
  preferred?: string,
): FundingPlan {
  if (!(targetFiat > 0)) return { ok: true, legs: [], raised: 0, short: 0 };

  const usable = sources
    .filter((s) => s.amount > 0 && s.fiatPerUnit > 0 && Number.isFinite(s.fiatPerUnit))
    .map((s) => ({ ...s, value: s.amount * s.fiatPerUnit }));

  const pref = preferred?.toUpperCase();
  const ordered = [...usable].sort((a, b) => {
    const aPref = a.symbol.toUpperCase() === pref ? 1 : 0;
    const bPref = b.symbol.toUpperCase() === pref ? 1 : 0;
    if (aPref !== bPref) return bPref - aPref;
    // The payout currency converts 1:1 — spending it costs the user no spread.
    const aOne = Math.abs(a.fiatPerUnit - 1) < 1e-9 ? 1 : 0;
    const bOne = Math.abs(b.fiatPerUnit - 1) < 1e-9 ? 1 : 0;
    if (aOne !== bOne) return bOne - aOne;
    return b.value - a.value;
  });

  const legs: FundingLeg[] = [];
  let raised = 0;

  for (const s of ordered) {
    const need = targetFiat - raised;
    if (need <= EPS) break;

    // Take only what's needed, never more than the wallet holds.
    const take = Math.min(s.amount, need / s.fiatPerUnit);
    if (!(take > 0)) continue;

    const fiat = take * s.fiatPerUnit;
    legs.push({ symbol: s.symbol, take, fiat });
    raised += fiat;
  }

  const short = Math.max(0, targetFiat - raised);
  return { ok: short <= EPS, legs, raised, short };
}

/** "10 USDT + 0.4 SOL + ₦25,000" — for showing the user what will be debited. */
export function describePlan(plan: FundingPlan, format: (leg: FundingLeg) => string): string {
  return plan.legs.map(format).join(" + ");
}
