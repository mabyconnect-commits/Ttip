import { test } from "node:test";
import assert from "node:assert/strict";
import { payoutCountry, payoutCurrencySupported } from "../src/lib/settlement/payout-country";
import { FIATS } from "../src/lib/constants";

test("payoutCountry maps the currencies we actually support", () => {
  assert.equal(payoutCountry("NGN"), "NG");
  assert.equal(payoutCountry("GHS"), "GH");
  assert.equal(payoutCountry("KES"), "KE");
  assert.equal(payoutCountry("ZAR"), "ZA");
  assert.equal(payoutCountry("UGX"), "UG");
  assert.equal(payoutCountry("TZS"), "TZ");
  assert.equal(payoutCountry("ngn"), "NG"); // case-insensitive
});

/**
 * The bug this guards: the old ternary ended in `: "NG"`, so ANY unmapped
 * currency resolved against Nigerian banks. A Ugandan payout would have been
 * sent to whichever Nigerian bank fuzzy-matched the name.
 */
test("payoutCountry refuses rather than defaulting to Nigeria", () => {
  for (const code of ["XOF", "XAF", "EGP", "MAD", "ETB", "USD", "EUR", "ZZZ", ""]) {
    assert.equal(payoutCountry(code), null, `${code} must not resolve to a country`);
  }
  // @ts-expect-error — guard against a missing/!undefined currency at runtime.
  assert.equal(payoutCountry(undefined), null);
});

test("payoutCurrencySupported mirrors payoutCountry", () => {
  assert.equal(payoutCurrencySupported("NGN"), true);
  assert.equal(payoutCurrencySupported("XOF"), false);
});

/**
 * Every currency offered in the picker must be either payable or knowingly
 * display-only — this test exists so adding a FIATS entry forces a decision
 * about payouts instead of silently inheriting a wrong country.
 */
test("every offered fiat is either payable or explicitly display-only", () => {
  const displayOnly = new Set(["XOF", "XAF", "EGP", "MAD", "ETB", "USD"]);
  for (const f of FIATS) {
    const payable = payoutCurrencySupported(f.code);
    assert.equal(
      payable,
      !displayOnly.has(f.code),
      `${f.code} is neither a supported payout currency nor listed as display-only`,
    );
  }
});
