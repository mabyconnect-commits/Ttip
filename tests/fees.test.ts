import { test } from "node:test";
import assert from "node:assert/strict";
import { providerTransferFee, transferFee } from "../src/lib/fees";
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
