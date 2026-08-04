import { test } from "node:test";
import assert from "node:assert/strict";
import {
  providerTransferFee,
  transferFee,
  depositFee,
  depositFeeSchedule,
  billFee,
  cryptoDepositFeePct,
} from "../src/lib/fees";
import { payoutCurrencySupported } from "../src/lib/settlement/payout-country";
import { FIATS } from "../src/lib/constants";

/**
 * Flutterwave's published bank-transfer payout pricing.
 * https://flutterwave.com/ke/support/pricing/pricing-for-transfers-and-payouts
 */
test("provider transfer fee matches Flutterwave's published schedule", () => {
  // NGN is tiered.
  assert.equal(providerTransferFee(1000, "NGN"), 10);
  assert.equal(providerTransferFee(5000, "NGN"), 10);
  assert.equal(providerTransferFee(5001, "NGN"), 25);
  assert.equal(providerTransferFee(50000, "NGN"), 25);
  assert.equal(providerTransferFee(50001, "NGN"), 50);
  // The rest are flat.
  assert.equal(providerTransferFee(1000, "GHS"), 10);
  assert.equal(providerTransferFee(1000, "KES"), 100);
  assert.equal(providerTransferFee(1000, "ZAR"), 10);
  assert.equal(providerTransferFee(1000, "UGX"), 5000);
  assert.equal(providerTransferFee(1000, "TZS"), 3000);
  assert.equal(providerTransferFee(1000, "RWF"), 2000);
});

/**
 * The bug this guards: `providerTransferFee` used to `return 0` for every
 * currency except NGN, so we charged the user nothing on a Ghanaian or Kenyan
 * withdrawal while Flutterwave still billed us — a loss on every transaction.
 */
test("no supported payout currency is ever free", () => {
  for (const f of FIATS) {
    if (!payoutCurrencySupported(f.code)) continue;
    const raw = providerTransferFee(10_000, f.code);
    assert.notEqual(raw, null, `${f.code} is offered for payout but has no fee`);
    assert.ok((raw as number) > 0, `${f.code} would be settled at a loss (fee ${raw})`);
    assert.ok((transferFee(10_000, f.code) as number) > 0, `${f.code} charges the user nothing`);
  }
});

test("an unpriceable currency returns null, never 0", () => {
  for (const code of ["XOF", "XAF", "EGP", "MAD", "ETB", "USD", "ZMW", ""]) {
    assert.equal(providerTransferFee(1000, code), null, `${code} must not be priced`);
    assert.equal(transferFee(1000, code), null, `${code} must not be charged`);
  }
});

test("every payout currency we price is also one we can route", () => {
  // A fee table entry without a country mapping would be a currency we quote
  // but can't actually send.
  for (const code of ["NGN", "GHS", "KES", "ZAR", "UGX", "TZS", "RWF"]) {
    assert.ok(payoutCurrencySupported(code), `${code} is priced but has no payout country`);
  }
});

test("the markup is applied identically in every currency", () => {
  // Default markup is 20%, rounded up — naira gets no special treatment.
  assert.equal(transferFee(1000, "NGN"), Math.ceil(10 * 1.2)); // 12
  assert.equal(transferFee(60000, "NGN"), Math.ceil(50 * 1.2)); // 60
  assert.equal(transferFee(1000, "KES"), Math.ceil(100 * 1.2)); // 120
  assert.equal(transferFee(1000, "UGX"), Math.ceil(5000 * 1.2)); // 6000
  // Always at least the provider's cost, so a payout can never lose money.
  for (const code of ["NGN", "GHS", "KES", "ZAR", "UGX", "TZS", "RWF"]) {
    const raw = providerTransferFee(10_000, code) as number;
    assert.ok((transferFee(10_000, code) as number) >= raw, `${code} charges below cost`);
  }
});

// ---- deposit fees -----------------------------------------------------------
// A fiat deposit used to credit the full amount while the provider still billed
// us ~1.5% to collect it, so every deposit drained the float.

test("a fiat deposit recovers the provider's cost, with no markup by default", () => {
  // ₦10,000 at 1.5% = ₦150 cost. Marking that up taxes the one action we most
  // want people to take, so the default markup is 0.
  assert.equal(depositFee(10000, "NGN", 0.015), 150);
});

test("a flat deposit fee overrides the percentage", () => {
  // Virtual-account inflows are billed per transfer, not as a percentage.
  process.env.DEPOSIT_FEE_FLAT_NGN = "50";
  try {
    assert.equal(depositFee(10000, "NGN", 0.015), 50);
    assert.equal(depositFee(1_000_000, "NGN", 0.015), 50, "flat means flat");
    assert.equal(depositFeeSchedule("NGN", 0.015).flat, 50);
  } finally {
    delete process.env.DEPOSIT_FEE_FLAT_NGN;
  }
});

test("deposits can be made free outright", () => {
  process.env.DEPOSIT_FEE_FLAT_NGN = "0";
  try {
    assert.equal(depositFee(10000, "NGN", 0.015), 0);
  } finally {
    delete process.env.DEPOSIT_FEE_FLAT_NGN;
  }
});

test("the deposit fee is capped, so a large deposit isn't gouged", () => {
  // Flutterwave caps NGN collection at ₦2,000 however large the transfer, so an
  // uncapped 1.5% on ₦1,000,000 would charge ₦18,000 against a ₦2,000 cost.
  assert.equal(depositFee(1_000_000, "NGN", 0.015), 2000);
  assert.ok(depositFee(1_000_000, "NGN", 0.015) < 1_000_000 * 0.015);
});

test("the deposit fee can never exceed the deposit", () => {
  assert.ok(depositFee(10, "NGN", 0.015) <= 10);
  assert.equal(depositFee(0, "NGN", 0.015), 0);
  assert.equal(depositFee(-5, "NGN", 0.015), 0);
});

test("the quoted schedule matches what is actually charged", () => {
  // The screen shows pct + cap; the webhook charges depositFee(). They must agree
  // or the user is told one number and debited another.
  const s = depositFeeSchedule("NGN", 0.015);
  const amount = 10000;
  const quoted = Math.min(Math.ceil(amount * s.pct), s.cap ?? Infinity);
  assert.equal(quoted, depositFee(amount, "NGN", 0.015));
});

test("an uncapped currency charges the straight percentage", () => {
  assert.equal(depositFeeSchedule("GHS", 0.02).cap, null);
  assert.equal(depositFee(1000, "GHS", 0.02), Math.ceil(1000 * 0.02));
});

// ---- bill service fee -------------------------------------------------------

test("a bill charges a service fee on top of the face value", () => {
  // ₦1,000 airtime at 1% = ₦10. The biller still receives the full ₦1,000.
  assert.equal(billFee(1000), 10);
});

test("the bill fee is capped so a big bill isn't punished", () => {
  assert.equal(billFee(500_000), 100);
  assert.ok(billFee(500_000) < 500_000 * 0.01);
});

test("no bill, no fee", () => {
  assert.equal(billFee(0), 0);
  assert.equal(billFee(-100), 0);
});

test("crypto deposits charge nothing until the provider's terms are confirmed", () => {
  // Charging on top of a fee the provider already netted off would double-bill.
  assert.equal(cryptoDepositFeePct(), 0);
});
