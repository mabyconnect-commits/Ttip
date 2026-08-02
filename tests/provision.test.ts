import { test } from "node:test";
import assert from "node:assert/strict";
import { generateAddress, makeReferralCode, pickGradient } from "../src/lib/provision";

test("generateAddress is deterministic for the same seed", () => {
  const a = generateAddress("erc20", "user123ETH");
  const b = generateAddress("erc20", "user123ETH");
  assert.equal(a, b);
});

test("generateAddress differs across seeds and networks", () => {
  assert.notEqual(generateAddress("erc20", "a"), generateAddress("erc20", "b"));
  assert.notEqual(generateAddress("erc20", "a"), generateAddress("trc20", "a"));
});

test("generateAddress uses the right prefix per network", () => {
  assert.match(generateAddress("erc20", "s"), /^0x[0-9a-f]{40}$/);
  assert.match(generateAddress("trc20", "s"), /^T[1-9A-HJ-NP-Za-km-z]{33}$/);
  assert.match(generateAddress("btc", "s"), /^bc1q/);
  assert.match(generateAddress("sol", "s"), /^[1-9A-HJ-NP-Za-km-z]{44}$/);
});

test("makeReferralCode is derived from the username and uppercase", () => {
  const code = makeReferralCode("kola");
  assert.match(code, /^KOLA[A-Z0-9]{4}$/);
});

test("makeReferralCode falls back to TTIP for empty usernames", () => {
  const code = makeReferralCode("!!!");
  assert.match(code, /^TTIP[A-Z0-9]{4}$/);
});

test("pickGradient is stable per seed and returns a known gradient", () => {
  const g1 = pickGradient("kola");
  const g2 = pickGradient("kola");
  assert.equal(g1, g2);
  assert.match(g1, /^135deg,/);
});
