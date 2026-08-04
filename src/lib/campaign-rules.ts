/**
 * Whether one referred signup counts toward an influencer's target.
 *
 * The deal is "get N people to sign up, put in at least ₦X of real money, trade,
 * and STILL be holding it Y hours later". Every clause is there to stop a
 * specific way of gaming it:
 *
 *   real money   — the platform can create balances (bonuses, and historically a
 *                  deposit simulator). Only money a payment provider actually
 *                  settled counts, or an influencer gets paid for balances
 *                  nobody funded.
 *   traded       — an account that deposits and does nothing is a number, not a
 *                  user. The point of the deal is activity.
 *   held N hours — without it, ₦1,000 in and straight back out qualifies, and
 *                  the same ₦1,000 can walk a hundred accounts through the
 *                  target in an afternoon.
 *   still holds  — checked NOW, not at deposit time, so withdrawing later
 *                  removes the qualification instead of banking it.
 *
 * Pure and dependency-free, so the rule that decides who gets paid is exactly
 * testable. The caller gathers the facts; this only judges them.
 */

export interface CampaignRules {
  /** Real money that must have been deposited, in NGN. */
  minDepositNgn: number;
  /** Must have swapped or bought at least once. */
  requireTrade: boolean;
  /** Hours the qualifying deposit must have been on the platform. */
  holdHours: number;
  /** Value the account must STILL hold, in NGN. */
  minHoldNgn: number;
}

export interface ReferralFacts {
  /** When they signed up. */
  joinedAt: Date;
  /** Real, provider-settled deposits: NGN value and when each landed. */
  realDeposits: { ngn: number; at: Date }[];
  /** Has swapped or bought at least once. */
  traded: boolean;
  /** What the account is holding right now, in NGN. */
  holdingNgn: number;
}

export type Disqualifier = "window" | "deposit" | "trade" | "hold-time" | "hold-amount";

export interface Qualification {
  qualified: boolean;
  /** Why not, when it isn't. Useful for showing an influencer where they stand. */
  reason?: Disqualifier;
}

export function qualifies(
  facts: ReferralFacts,
  rules: CampaignRules,
  window: { startsAt: Date; endsAt?: Date | null },
  now: Date = new Date(),
): Qualification {
  // Signups from before the deal was struck don't count — an existing audience
  // can't be sold twice.
  if (facts.joinedAt < window.startsAt) return { qualified: false, reason: "window" };
  if (window.endsAt && facts.joinedAt > window.endsAt) return { qualified: false, reason: "window" };

  // The earliest real deposit that on its own meets the minimum. Using the
  // earliest means the hold clock starts as early as possible, which is the
  // reading that favours the influencer.
  const qualifying = facts.realDeposits
    .filter((d) => d.ngn >= rules.minDepositNgn)
    .sort((a, b) => a.at.getTime() - b.at.getTime())[0];
  if (!qualifying) return { qualified: false, reason: "deposit" };

  if (rules.requireTrade && !facts.traded) return { qualified: false, reason: "trade" };

  const heldMs = now.getTime() - qualifying.at.getTime();
  if (heldMs < rules.holdHours * 3600_000) return { qualified: false, reason: "hold-time" };

  // Checked against the balance NOW: cashing out later un-qualifies.
  if (facts.holdingNgn < rules.minHoldNgn) return { qualified: false, reason: "hold-amount" };

  return { qualified: true };
}

/** Human-readable version of a disqualifier, for the admin screen. */
export function describeDisqualifier(d: Disqualifier): string {
  switch (d) {
    case "window": return "signed up outside the campaign window";
    case "deposit": return "no real deposit at the minimum yet";
    case "trade": return "hasn't traded yet";
    case "hold-time": return "hold period not yet elapsed";
    case "hold-amount": return "no longer holding the minimum";
  }
}
