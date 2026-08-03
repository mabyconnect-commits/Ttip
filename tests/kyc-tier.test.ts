import { test } from "node:test";
import assert from "node:assert/strict";
import { tierFor, withIdType } from "../src/lib/kyc/tier";
import { KYC_TIERS, kycTierDef } from "../src/lib/constants";

/**
 * The bug this guards: the KYC route granted `Math.max(2, result.tier)`, so
 * verifying a BVN — which only proves the person is bank-verified — jumped
 * straight to Tier 2 and its ₦5,000,000 daily limit.
 */
test("a BVN alone is Tier 1, not Tier 2", () => {
  assert.equal(tierFor(["bvn"]), 1);
});

test("BVN plus any government ID is Tier 2", () => {
  assert.equal(tierFor(["bvn", "nin"]), 2);
  assert.equal(tierFor(["bvn", "passport"]), 2);
  assert.equal(tierFor(["bvn", "drivers_license"]), 2);
});

test("proof of address on top is Tier 3", () => {
  assert.equal(tierFor(["bvn", "nin", "address"]), 3);
});

test("no BVN means no withdrawals, whatever else is on file", () => {
  assert.equal(tierFor([]), 0);
  assert.equal(tierFor(["nin"]), 0);
  assert.equal(tierFor(["nin", "passport", "address"]), 0);
});

test("tier detection is case-insensitive and order-independent", () => {
  assert.equal(tierFor(["NIN", "BVN"]), 2);
  assert.equal(tierFor(["Address", "nin", "bvn"]), 3);
});

test("withIdType appends without duplicating", () => {
  assert.deepEqual(withIdType([], "bvn"), ["bvn"]);
  assert.deepEqual(withIdType(["bvn"], "nin"), ["bvn", "nin"]);
  assert.deepEqual(withIdType(["bvn"], "bvn"), ["bvn"]);
  assert.deepEqual(withIdType(["bvn"], "BVN"), ["bvn"]);
});

test("Tier 1 carries the regular starter limits", () => {
  const t1 = kycTierDef(1);
  assert.equal(t1.dailyNgn, 500_000);
  assert.equal(t1.perTransferNgn, 100_000);
});

test("limits only ever increase up the ladder, and tier 0 cannot withdraw", () => {
  assert.equal(kycTierDef(0).perTransferNgn, 0);
  const rungs = KYC_TIERS.filter((t) => t.tier > 0);
  for (let i = 1; i < rungs.length; i++) {
    assert.ok(rungs[i].dailyNgn > rungs[i - 1].dailyNgn, `tier ${rungs[i].tier} daily must exceed the one below`);
    assert.ok(rungs[i].perTransferNgn > rungs[i - 1].perTransferNgn, `tier ${rungs[i].tier} per-transfer must exceed the one below`);
  }
  // A per-transfer limit above the daily limit would be unreachable.
  for (const t of KYC_TIERS) {
    assert.ok(t.perTransferNgn <= t.dailyNgn, `tier ${t.tier} per-transfer exceeds its own daily limit`);
  }
});

test("an unknown tier falls back to the most restrictive rung", () => {
  assert.equal(kycTierDef(99).tier, 0);
  assert.equal(kycTierDef(-1).perTransferNgn, 0);
});
