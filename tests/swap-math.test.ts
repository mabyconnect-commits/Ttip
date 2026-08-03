import { test } from "node:test";
import assert from "node:assert/strict";
import { freeSwapsLeft, quoteSwap, FREE_SWAPS_PER_DAY } from "../src/lib/swap-math";
import { SWAP_FEE_PCT } from "../src/lib/constants";

test("freeSwapsLeft resets on a new calendar day", () => {
  assert.equal(freeSwapsLeft("2026-07-31", 0, "2026-08-01"), FREE_SWAPS_PER_DAY);
  assert.equal(freeSwapsLeft(null, 0, "2026-08-01"), FREE_SWAPS_PER_DAY);
});

test("freeSwapsLeft keeps the stored counter within the same day", () => {
  assert.equal(freeSwapsLeft("2026-08-01", 1, "2026-08-01"), Math.min(1, FREE_SWAPS_PER_DAY));
  assert.equal(freeSwapsLeft("2026-08-01", 0, "2026-08-01"), 0);
});

test("free swaps are OFF by default — every swap is priced", () => {
  // A free swap earns 0% and still accrues 0.15% cashback on its volume, so it
  // is a straight loss. If this ever reads above 0 without FREE_SWAPS_PER_DAY
  // being set deliberately, the platform is paying users to trade again.
  assert.equal(FREE_SWAPS_PER_DAY, 0);
  assert.equal(freeSwapsLeft(null, 0, "2026-08-01"), 0);
  assert.equal(quoteSwap(100, 200, 0).feePct, SWAP_FEE_PCT);
});

test("lowering the allowance takes effect the same day", () => {
  // Someone who banked 3 free swaps this morning must not keep them.
  assert.ok(freeSwapsLeft("2026-08-01", 3, "2026-08-01") <= FREE_SWAPS_PER_DAY);
});

test("quoteSwap charges no fee while free swaps remain", () => {
  const q = quoteSwap(100, 100, 3);
  assert.equal(q.free, true);
  assert.equal(q.feePct, 0);
  assert.equal(q.net, 100);
  assert.equal(q.rate, 1);
});

test("quoteSwap applies the swap fee once the free allowance is spent", () => {
  const gross = 200;
  const q = quoteSwap(100, gross, 0);
  assert.equal(q.free, false);
  assert.equal(q.feePct, SWAP_FEE_PCT);
  assert.ok(Math.abs(q.net - gross * (1 - SWAP_FEE_PCT)) < 1e-9);
  assert.ok(Math.abs(q.rate - q.net / 100) < 1e-9);
});

test("quoteSwap never divides by zero on a zero input", () => {
  const q = quoteSwap(0, 0, 0);
  assert.equal(q.rate, 0);
  assert.equal(Number.isFinite(q.rate), true);
});
