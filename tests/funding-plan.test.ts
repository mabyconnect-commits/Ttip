import test from "node:test";
import assert from "node:assert/strict";
import { planFunding, type FundingSource } from "../src/lib/funding-plan";

/**
 * The scenario this exists for: $10 of USDT, $15 of SOL, ₦25,000 — and the user
 * wants to send ₦50,000. No single wallet covers it; together they do.
 */

// 1 USDT = ₦1,600 to the user (sell rate), 1 SOL = ₦200,000, NGN is 1:1.
const WALLET: FundingSource[] = [
  { symbol: "NGN", amount: 25_000, fiatPerUnit: 1 },
  { symbol: "USDT", amount: 10, fiatPerUnit: 1_600 },
  { symbol: "SOL", amount: 0.075, fiatPerUnit: 200_000 },
];

test("spreads a withdrawal across every wallet that can pay", () => {
  const plan = planFunding(50_000, WALLET);
  assert.equal(plan.ok, true);
  assert.ok(plan.legs.length > 1, "should use more than one wallet");
  assert.ok(Math.abs(plan.raised - 50_000) < 1e-6);
});

test("never debits more than a wallet holds", () => {
  const plan = planFunding(50_000, WALLET);
  for (const leg of plan.legs) {
    const src = WALLET.find((w) => w.symbol === leg.symbol)!;
    assert.ok(leg.take <= src.amount + 1e-9, `${leg.symbol} overdrawn`);
  }
});

test("spends the payout currency first — it costs the user no spread", () => {
  // ₦25,000 of naira should be used before any crypto is converted.
  const plan = planFunding(50_000, WALLET);
  assert.equal(plan.legs[0].symbol, "NGN");
  assert.ok(Math.abs(plan.legs[0].take - 25_000) < 1e-6, "should spend the whole naira balance");
});

test("honours the wallet the user actually picked, before naira", () => {
  const plan = planFunding(50_000, WALLET, "USDT");
  assert.equal(plan.legs[0].symbol, "USDT");
  assert.equal(plan.legs[1].symbol, "NGN", "then the no-spread currency");
});

test("one wallet that covers it is used alone", () => {
  const plan = planFunding(20_000, WALLET);
  assert.equal(plan.ok, true);
  assert.equal(plan.legs.length, 1);
  assert.equal(plan.legs[0].symbol, "NGN");
  assert.ok(Math.abs(plan.legs[0].take - 20_000) < 1e-6);
});

test("reports the shortfall rather than silently underpaying", () => {
  const plan = planFunding(10_000_000, WALLET);
  assert.equal(plan.ok, false);
  assert.ok(plan.short > 0);
  // Everything available was still accounted for.
  const total = WALLET.reduce((n, w) => n + w.amount * w.fiatPerUnit, 0);
  assert.ok(Math.abs(plan.raised - total) < 1e-6);
});

test("exactly the total balance is affordable", () => {
  const total = WALLET.reduce((n, w) => n + w.amount * w.fiatPerUnit, 0);
  const plan = planFunding(total, WALLET);
  assert.equal(plan.ok, true, "spending the entire balance must be allowed");
  assert.ok(plan.short <= 1e-6);
});

test("skips wallets with no balance or no usable rate", () => {
  const plan = planFunding(1_000, [
    { symbol: "BTC", amount: 0, fiatPerUnit: 90_000_000 },
    { symbol: "DOGE", amount: 500, fiatPerUnit: 0 }, // rate unavailable
    { symbol: "NGN", amount: 5_000, fiatPerUnit: 1 },
  ]);
  assert.deepEqual(plan.legs.map((l) => l.symbol), ["NGN"]);
});

test("a zero or negative target plans nothing", () => {
  assert.deepEqual(planFunding(0, WALLET).legs, []);
  assert.equal(planFunding(0, WALLET).ok, true);
  assert.deepEqual(planFunding(-5, WALLET).legs, []);
});

test("no wallets at all is a shortfall, not a crash", () => {
  const plan = planFunding(1_000, []);
  assert.equal(plan.ok, false);
  assert.equal(plan.raised, 0);
  assert.equal(plan.short, 1_000);
});

test("floating point can't leave an affordable withdrawal a hair short", () => {
  // 3 × 0.1 is famously not 0.3 in binary floating point.
  const plan = planFunding(0.3, [
    { symbol: "A", amount: 0.1, fiatPerUnit: 1 },
    { symbol: "B", amount: 0.1, fiatPerUnit: 1 },
    { symbol: "C", amount: 0.1, fiatPerUnit: 1 },
  ]);
  assert.equal(plan.ok, true);
});
