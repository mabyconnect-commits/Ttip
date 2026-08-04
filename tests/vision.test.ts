import test from "node:test";
import assert from "node:assert/strict";
import { validate, matchBank, imageMediaType } from "../src/lib/assistant/vision";

/**
 * Reading an account off a photo.
 *
 * The model is an OCR engine here, not a decision-maker: everything it returns
 * is checked before it can reach a payment. These tests are that check. A
 * nine-digit "NUBAN" or a bank we have no code for must fall through to a
 * question, never to a transfer — a wrong digit pays a stranger.
 */

const j = (o: unknown) => JSON.stringify(o);

test("a clean read passes through", () => {
  const r = validate(j({ accountNumber: "9077984753", bankName: "Opay", printedName: "ABIKE VICTORIA IBRAHIM", amount: 7000 }));
  assert.equal(r.accountNumber, "9077984753");
  // The canonical name from our own bank list, which is what a payout needs.
  assert.equal(r.bankName, "Opay (Paycom)");
  assert.equal(r.printedName, "ABIKE VICTORIA IBRAHIM");
  assert.equal(r.amount, 7000);
});

test("an account number that isn't 10 digits is dropped", () => {
  assert.equal(validate(j({ accountNumber: "907798475" })).accountNumber, null);
  assert.equal(validate(j({ accountNumber: "90779847531" })).accountNumber, null);
  assert.equal(validate(j({ accountNumber: "" })).accountNumber, null);
  assert.equal(validate(j({ accountNumber: null })).accountNumber, null);
});

test("separators in a printed account number are tolerated", () => {
  assert.equal(validate(j({ accountNumber: "907 798 4753" })).accountNumber, "9077984753");
  assert.equal(validate(j({ accountNumber: "9077-984-753" })).accountNumber, "9077984753");
});

test("a bank we can't pay becomes null, not a guess", () => {
  assert.equal(validate(j({ bankName: "Bank of Narnia" })).bankName, null);
  assert.equal(validate(j({ bankName: "" })).bankName, null);
});

test("the short forms people actually write down resolve", () => {
  assert.equal(matchBank("Opay"), "Opay (Paycom)");
  assert.equal(matchBank("Opay (Paycom)"), "Opay (Paycom)");
  assert.equal(matchBank("OPAY DIGITAL SERVICES"), "Opay (Paycom)");
  assert.ok(/guaranty/i.test(matchBank("GTB") ?? ""), matchBank("GTB") ?? "null");
  assert.ok(/united bank/i.test(matchBank("UBA") ?? ""), matchBank("UBA") ?? "null");
  assert.ok(/first city/i.test(matchBank("FCMB") ?? ""), matchBank("FCMB") ?? "null");
});

test("a bank name with corporate noise still resolves", () => {
  assert.ok(/zenith/i.test(matchBank("Zenith Bank Plc") ?? ""), matchBank("Zenith Bank Plc") ?? "null");
  assert.ok(/kuda/i.test(matchBank("Kuda Microfinance Bank") ?? ""), matchBank("Kuda Microfinance Bank") ?? "null");
});

test("a non-positive amount is dropped rather than sent", () => {
  assert.equal(validate(j({ amount: 0 })).amount, null);
  assert.equal(validate(j({ amount: -500 })).amount, null);
  assert.equal(validate(j({ amount: "not a number" })).amount, null);
});

test("an amount written with a currency symbol survives", () => {
  assert.equal(validate(j({ amount: "₦7,000" })).amount, 7000);
});

test("a response that isn't JSON yields nothing, not a crash", () => {
  for (const bad of ["", "sorry, I can't read that", "{broken", "null"]) {
    const r = validate(bad);
    assert.equal(r.accountNumber, null, bad);
    assert.equal(r.amount, null, bad);
  }
});

test("a JSON object wrapped in prose or a code fence is still read", () => {
  const wrapped = 'Here you go:\n```json\n{"accountNumber":"9077984753","bankName":"Opay"}\n```';
  assert.equal(validate(wrapped).accountNumber, "9077984753");
});

test("an absurdly long printed name is dropped", () => {
  assert.equal(validate(j({ printedName: "A".repeat(200) })).printedName, null);
});

test("only image types Claude accepts are allowed through", () => {
  assert.equal(imageMediaType("image/jpeg"), "image/jpeg");
  assert.equal(imageMediaType("image/jpg"), "image/jpeg");
  assert.equal(imageMediaType("image/png;charset=binary"), "image/png");
  assert.equal(imageMediaType("image/heic"), null);
  assert.equal(imageMediaType("application/pdf"), null);
  assert.equal(imageMediaType(undefined), null);
});
