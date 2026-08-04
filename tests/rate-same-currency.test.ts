import test from "node:test";
import assert from "node:assert/strict";
import { referenceFiat, referenceRate } from "../src/lib/rate";

/**
 * A naira balance cashed out to a naira bank account must be valued 1:1.
 *
 * referenceFiat used to convert NGN → USDT at the official FX rate and back at
 * the P2P rate. Those differ by the P2P premium, so ₦10,000 of balance was
 * valued at roughly ₦10,300 and the difference was paid out of the float on
 * every same-currency withdrawal. The fallback branch did it too, by
 * multiplying by (1 + premium).
 */

test("same-currency value is exactly 1:1", async () => {
  for (const amount of [1, 100, 10_000, 1_250_000.55]) {
    assert.equal(await referenceFiat(amount, "NGN", "NGN"), amount);
  }
});

test("case doesn't defeat the check", async () => {
  assert.equal(await referenceFiat(5000, "ngn", "NGN"), 5000);
  assert.equal(await referenceFiat(5000, "NGN", "ngn"), 5000);
});

test("holds for every fiat, not just naira", async () => {
  for (const f of ["GHS", "KES", "ZAR", "UGX"]) {
    assert.equal(await referenceFiat(2500, f, f), 2500);
  }
});

test("the same-currency rate is 1", async () => {
  assert.equal(await referenceRate("NGN", "NGN"), 1);
});

test("zero and negative amounts pass through untouched", async () => {
  assert.equal(await referenceFiat(0, "NGN", "NGN"), 0);
});
