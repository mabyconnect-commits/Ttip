import { test } from "node:test";
import assert from "node:assert/strict";
import { quoteSell } from "../src/lib/pricing";

/**
 * Models the float-shortfall scenario without a DB: a user off-ramps more than
 * the float holds, treasury crypto is liquidated to cover it, and the leftover
 * crypto is the platform's spread.
 */
test("float shortfall is covered by liquidating treasury crypto, leaving the spread", () => {
  const marketRate = 1600; // ₦ per USDT
  const deposited = 100; // user deposited 100 USDT → treasury holds 100 USDT
  const floatNaira = 10_000; // float is far short of the payout

  // User withdraws all 100 USDT to bank at a 1.5% margin.
  const q = quoteSell({ asset: "USDT", fiat: "NGN", amountAsset: deposited, marketRate, marginPct: 0.015 });
  const payout = q.userFiat; // ₦157,600

  // Shortfall the treasury must raise by selling crypto at market.
  const shortfall = payout - floatNaira; // 147,600
  const soldUsdt = shortfall / marketRate; // ~92.25 USDT
  assert.ok(soldUsdt < deposited); // we never sell more than we hold

  // Leftover treasury crypto after funding the payout = our profit.
  const leftover = deposited - soldUsdt;
  const leftoverNaira = leftover * marketRate;
  assert.ok(leftoverNaira > 0);
  // Profit ≈ the quoted spread (float already held part of the payout).
  assert.ok(Math.abs(leftoverNaira - (q.spreadFiat + floatNaira)) < 1e-6);
});
