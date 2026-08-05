import { test } from "node:test";
import assert from "node:assert/strict";
import { quoteSell, quoteBuy, platformMargin } from "../src/lib/pricing";
import { PLATFORM_MARGIN_PCT } from "../src/lib/constants";
import { hasUsdPrice } from "../src/lib/prices";

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

test("transferFee adds the markup on the provider's NGN tier fee", async () => {
  const { transferFee, providerTransferFee } = await import("../src/lib/pricing");
  // ₦10 base + 20% = ₦12 for small transfers
  assert.equal(providerTransferFee(3000, "NGN"), 10);
  assert.equal(transferFee(3000, "NGN"), 12);
  // ₦25 base + 20% = ₦30 for mid transfers
  assert.equal(transferFee(20000, "NGN"), 30);
  // ₦50 base + 20% = ₦60 for large transfers
  assert.equal(transferFee(100000, "NGN"), 60);
});

test("an unpriced token is known to be unpriced", async () => {
  // usdPrice falls back to $1 per unit for anything it doesn't know. Harmless
  // in a display corner, dangerous where it sizes a transfer: it valued 2 PENGU
  // at $2, and the withdrawal quote came back offering 287 PENGU.
  assert.equal(await hasUsdPrice("PENGU"), false);
  assert.equal(await hasUsdPrice("SOMECOIN"), false);
  assert.equal(await hasUsdPrice(""), false);

  // The rails we actually carry stay priceable, feed or no feed.
  for (const s of ["USDT", "USDC", "BTC", "ETH", "SOL", "NGN", "USD"]) {
    assert.equal(await hasUsdPrice(s), true, s);
  }
});
