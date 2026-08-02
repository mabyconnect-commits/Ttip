import { test } from "node:test";
import assert from "node:assert/strict";
import { quoteSell, quoteBuy, platformMargin } from "../src/lib/pricing";
import { PLATFORM_MARGIN_PCT } from "../src/lib/constants";

const approx = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("platformMargin falls back to the default when env is unset/invalid", () => {
  delete process.env.PLATFORM_MARGIN_PCT;
  assert.equal(platformMargin(), PLATFORM_MARGIN_PCT);
  process.env.PLATFORM_MARGIN_PCT = "0.02";
  assert.equal(platformMargin(), 0.02);
  process.env.PLATFORM_MARGIN_PCT = "not-a-number";
  assert.equal(platformMargin(), PLATFORM_MARGIN_PCT);
  delete process.env.PLATFORM_MARGIN_PCT;
});

test("quoteSell prices the user below market and captures the spread", () => {
  // 100 USDT at ₦1,600 market, 1.5% margin
  const q = quoteSell({ asset: "USDT", fiat: "NGN", amountAsset: 100, marketRate: 1600, marginPct: 0.015 });
  approx(q.userRate, 1576); // 1600 * 0.985
  approx(q.marketFiat, 160000);
  approx(q.userFiat, 157600);
  approx(q.spreadFiat, 2400); // platform revenue
  assert.ok(q.spreadFiat > 0);
});

test("quoteBuy prices the user above market and captures the spread", () => {
  const q = quoteBuy({ asset: "USDT", fiat: "NGN", amountAsset: 100, marketRate: 1600, marginPct: 0.015 });
  approx(q.userRate, 1624); // 1600 * 1.015
  approx(q.userFiat, 162400);
  approx(q.spreadFiat, 2400);
  assert.ok(q.spreadFiat > 0);
});

test("a tighter margin makes the user rate more competitive", () => {
  const tight = quoteSell({ asset: "USDT", fiat: "NGN", amountAsset: 1, marketRate: 1600, marginPct: 0.005 });
  const wide = quoteSell({ asset: "USDT", fiat: "NGN", amountAsset: 1, marketRate: 1600, marginPct: 0.03 });
  assert.ok(tight.userRate > wide.userRate); // tighter margin ⇒ user gets more
});
