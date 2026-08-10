import test from "node:test";
import assert from "node:assert/strict";
import {
  cryptoWithdrawFeeUsd,
  cryptoWithdrawFeeBreakevenUsd,
  maxCryptoWithdrawUsd,
  cryptoWithdrawFeePct,
  cryptoWithdrawFeeMinUsd,
} from "../src/lib/fees";

/**
 * 0.8% of the withdrawal, or $0.50 — whichever is larger.
 *
 * A flat $0.50 was fair on a $60 send and a giveaway on a $10,000 one. A pure
 * percentage has the opposite problem: 0.8% of $5 is four cents.
 */

test("the floor holds on small withdrawals", () => {
  assert.equal(cryptoWithdrawFeeUsd(1), 0.5);
  assert.equal(cryptoWithdrawFeeUsd(10), 0.5);
  assert.equal(cryptoWithdrawFeeUsd(50), 0.5);
  // 0.8% of $60 is $0.48 — still under the floor.
  assert.equal(cryptoWithdrawFeeUsd(60), 0.5);
});

test("the percentage takes over above the breakeven", () => {
  assert.equal(cryptoWithdrawFeeBreakevenUsd(), 62.5);
  assert.equal(cryptoWithdrawFeeUsd(100), 0.8);
  assert.equal(cryptoWithdrawFeeUsd(1000), 8);
  assert.equal(cryptoWithdrawFeeUsd(10_000), 80);
});

test("the two meet exactly, with no step in the curve", () => {
  // The moment sending one dollar more costs LESS is the moment someone splits
  // a withdrawal in two to game it.
  const b = cryptoWithdrawFeeBreakevenUsd();
  assert.equal(cryptoWithdrawFeeUsd(b), 0.5);
  assert.ok(cryptoWithdrawFeeUsd(b + 1) > 0.5);
  assert.ok(cryptoWithdrawFeeUsd(b - 1) === 0.5);

  // And it never pays to split: two halves of a large withdrawal cost at least
  // as much as one whole, never less.
  for (const total of [200, 1000, 5000]) {
    const whole = cryptoWithdrawFeeUsd(total);
    const split = cryptoWithdrawFeeUsd(total / 2) * 2;
    assert.ok(split >= whole - 1e-9, `${total} split cheaper than whole`);
  }
});

test("a zero or nonsense amount still quotes the floor, never zero", () => {
  // A fee of zero on an unpriced amount is a free withdrawal.
  assert.equal(cryptoWithdrawFeeUsd(0), 0.5);
  assert.equal(cryptoWithdrawFeeUsd(-5), 0.5);
  assert.equal(cryptoWithdrawFeeUsd(NaN), 0.5);
});

test("Max leaves exactly enough for the fee, on both sides of the breakeven", () => {
  // Tapping Max must not come back one fee short — the bug the bank-send Max
  // had before it did the same two-pass sum.
  for (const balance of [5, 30, 62.5, 100, 1000, 25_000]) {
    const max = maxCryptoWithdrawUsd(balance);
    const total = max + cryptoWithdrawFeeUsd(max);
    assert.ok(total <= balance + 1e-9, `balance ${balance}: ${total} > ${balance}`);
    // And it isn't needlessly conservative — within a cent of the balance.
    assert.ok(total >= balance - 0.01, `balance ${balance}: left ${balance - total} on the table`);
  }
});

test("a balance under the floor can withdraw nothing", () => {
  assert.equal(maxCryptoWithdrawUsd(0.4), 0);
  assert.equal(maxCryptoWithdrawUsd(0), 0);
});

test("the rate and floor are configurable, and blank means unset", () => {
  // Number("") is 0 — which as a fee rate means free withdrawals for everyone.
  for (const [set, want] of [["0.005", 0.005], ["", 0.008], ["-1", 0.008], ["2", 0.008]] as const) {
    process.env.NEXT_PUBLIC_WITHDRAW_FEE_PCT = set as string;
    assert.equal(cryptoWithdrawFeePct(), want, `pct=${set}`);
  }
  delete process.env.NEXT_PUBLIC_WITHDRAW_FEE_PCT;
  assert.equal(cryptoWithdrawFeeMinUsd(), 0.5);
});
