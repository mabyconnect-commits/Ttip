import { test } from "node:test";
import assert from "node:assert/strict";
import { bankAliases } from "../src/lib/bank-aliases";

/**
 * The case this exists for: Ttip displayed "Flutterwave MFB (Formerly OK MFB)",
 * but the sender's own bank listed the same institution as "Orokam Microfinance
 * Bank Ltd". Searching the displayed name found nothing.
 */
test("the Flutterwave MFB partner resolves to its other listed names", () => {
  const alts = bankAliases("Flutterwave MFB (Formerly OK MFB)");
  assert.ok(
    alts.some((a) => /orokam/i.test(a)),
    `expected an Orokam alias, got ${JSON.stringify(alts)}`,
  );
});

test("matching survives the (Formerly …) suffix, Ltd noise and casing", () => {
  for (const name of [
    "Flutterwave MFB",
    "flutterwave mfb (formerly ok mfb)",
    "FLUTTERWAVE MICROFINANCE BANK LTD",
  ]) {
    assert.ok(bankAliases(name).length > 0, `no aliases found for "${name}"`);
  }
});

test("the name asked about is never echoed back as its own alias", () => {
  const name = "Flutterwave MFB";
  assert.ok(!bankAliases(name).some((a) => a.toLowerCase() === name.toLowerCase()));
  // Orokam asked from the other direction shouldn't list Orokam either.
  assert.ok(!bankAliases("Orokam Microfinance Bank Ltd").some((a) => /^orokam microfinance bank ltd$/i.test(a)));
});

test("the lookup works from either direction", () => {
  assert.ok(bankAliases("Orokam Microfinance Bank Ltd").some((a) => /flutterwave/i.test(a)));
});

test("an unknown or empty bank yields nothing rather than a wrong guess", () => {
  assert.deepEqual(bankAliases("Some Bank We Don't Know"), []);
  assert.deepEqual(bankAliases(""), []);
  assert.deepEqual(bankAliases(null), []);
  assert.deepEqual(bankAliases(undefined), []);
});
