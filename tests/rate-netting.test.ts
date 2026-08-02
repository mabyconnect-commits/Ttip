import { test } from "node:test";
import assert from "node:assert/strict";
import { p2pPremium } from "../src/lib/rate";
import { computeNetting, nettedSellAmount } from "../src/lib/settlement/netting";

test("p2pPremium reads global and per-currency env, default 0", () => {
  delete process.env.P2P_PREMIUM_PCT;
  delete process.env.P2P_PREMIUM_NGN;
  assert.equal(p2pPremium("NGN"), 0);

  process.env.P2P_PREMIUM_PCT = "0.02";
  assert.equal(p2pPremium("NGN"), 0.02); // global applies

  process.env.P2P_PREMIUM_NGN = "0.05";
  assert.equal(p2pPremium("NGN"), 0.05); // per-currency overrides global
  assert.equal(p2pPremium("GHS"), 0.02); // other currency still global

  delete process.env.P2P_PREMIUM_PCT;
  delete process.env.P2P_PREMIUM_NGN;
});

test("computeNetting matches opposing flow and externalizes only the net", () => {
  assert.deepEqual(computeNetting(100, 40), { matched: 40, externalSell: 60, externalBuy: 0 });
  assert.deepEqual(computeNetting(30, 80), { matched: 30, externalSell: 0, externalBuy: 50 });
  assert.deepEqual(computeNetting(50, 50), { matched: 50, externalSell: 0, externalBuy: 0 });
});

test("nettedSellAmount only liquidates the unmatched remainder", () => {
  assert.equal(nettedSellAmount(100, 30), 70);
  assert.equal(nettedSellAmount(100, 120), 0); // fully covered by internal demand
  assert.equal(nettedSellAmount(100, 0), 100); // no demand ⇒ liquidate all
});
