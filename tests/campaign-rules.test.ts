import test from "node:test";
import assert from "node:assert/strict";
import { qualifies, type CampaignRules, type ReferralFacts } from "../src/lib/campaign-rules";

/**
 * The rule that decides whether an influencer gets paid ₦40,000. Every clause
 * below exists to stop a specific way of gaming the deal, so each one is tested
 * on its own.
 */

const RULES: CampaignRules = {
  minDepositNgn: 1000,
  requireTrade: true,
  holdHours: 72,
  minHoldNgn: 1000,
};

const START = new Date("2026-08-01T00:00:00Z");
const WINDOW = { startsAt: START };
const NOW = new Date("2026-08-10T00:00:00Z");

const good: ReferralFacts = {
  joinedAt: new Date("2026-08-02T00:00:00Z"),
  realDeposits: [{ ngn: 1000, at: new Date("2026-08-02T01:00:00Z") }],
  traded: true,
  holdingNgn: 1000,
};

test("a signup meeting every condition counts", () => {
  assert.equal(qualifies(good, RULES, WINDOW, NOW).qualified, true);
});

test("someone who joined before the deal doesn't count", () => {
  // Otherwise an existing audience could be sold twice.
  const before = { ...good, joinedAt: new Date("2026-07-20T00:00:00Z") };
  assert.equal(qualifies(before, RULES, WINDOW, NOW).reason, "window");
});

test("a deposit under the minimum doesn't count", () => {
  const small = { ...good, realDeposits: [{ ngn: 999, at: new Date("2026-08-02T01:00:00Z") }] };
  assert.equal(qualifies(small, RULES, WINDOW, NOW).reason, "deposit");
});

test("several small deposits don't add up to the minimum", () => {
  // The deal says a ₦1,000 deposit, not ₦1,000 of dust — otherwise ten ₦100
  // top-ups qualify and the hold clock becomes meaningless.
  const dust = {
    ...good,
    realDeposits: [
      { ngn: 500, at: new Date("2026-08-02T01:00:00Z") },
      { ngn: 500, at: new Date("2026-08-02T02:00:00Z") },
    ],
  };
  assert.equal(qualifies(dust, RULES, WINDOW, NOW).reason, "deposit");
});

test("platform-created balances can't qualify anyone", () => {
  // realDeposits carries ONLY provider-settled money. A bonus or a simulated
  // deposit never appears here, so an empty list can't qualify.
  const bonusOnly = { ...good, realDeposits: [] };
  assert.equal(qualifies(bonusOnly, RULES, WINDOW, NOW).reason, "deposit");
});

test("depositing and doing nothing doesn't count", () => {
  assert.equal(qualifies({ ...good, traded: false }, RULES, WINDOW, NOW).reason, "trade");
});

test("the hold period must actually have elapsed", () => {
  const justNow = {
    ...good,
    realDeposits: [{ ngn: 1000, at: new Date("2026-08-09T23:00:00Z") }], // 1h ago
  };
  assert.equal(qualifies(justNow, RULES, WINDOW, NOW).reason, "hold-time");
});

test("in and straight back out does not qualify", () => {
  // The classic: ₦1,000 in, ₦1,000 out, repeat with the next account.
  assert.equal(qualifies({ ...good, holdingNgn: 0 }, RULES, WINDOW, NOW).reason, "hold-amount");
});

test("qualification is lost if they cash out later", () => {
  // Checked against the balance NOW, not at deposit time.
  assert.equal(qualifies({ ...good, holdingNgn: 999 }, RULES, WINDOW, NOW).qualified, false);
});

test("the hold clock starts at the earliest qualifying deposit", () => {
  const twice = {
    ...good,
    realDeposits: [
      { ngn: 1000, at: new Date("2026-08-02T00:00:00Z") }, // 8 days ago
      { ngn: 5000, at: new Date("2026-08-09T00:00:00Z") }, // 1 day ago
    ],
  };
  assert.equal(qualifies(twice, RULES, WINDOW, NOW).qualified, true, "the older one starts the clock");
});

test("exactly at the threshold counts", () => {
  const exact = {
    ...good,
    realDeposits: [{ ngn: 1000, at: new Date("2026-08-07T00:00:00Z") }], // exactly 72h
    holdingNgn: 1000,
  };
  assert.equal(qualifies(exact, RULES, WINDOW, NOW).qualified, true);
});

test("a closed campaign window excludes later signups", () => {
  const w = { startsAt: START, endsAt: new Date("2026-08-01T12:00:00Z") };
  assert.equal(qualifies(good, RULES, w, NOW).reason, "window");
});

test("trade can be waived when the deal doesn't require it", () => {
  const noTrade = { ...RULES, requireTrade: false };
  assert.equal(qualifies({ ...good, traded: false }, noTrade, WINDOW, NOW).qualified, true);
});
