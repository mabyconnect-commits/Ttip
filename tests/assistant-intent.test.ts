import test from "node:test";
import assert from "node:assert/strict";
import { parseTransferIntent, parseAmount, parseTarget } from "../src/lib/assistant/intent";

/**
 * The amount is the one thing that must never be guessed. These read it out of
 * the text with a parser rather than asking a model, so 7,500 can never become
 * 75,000.
 */

test("reads a transfer request", () => {
  const i = parseTransferIntent("Hello Ada, help me transfer 7,500 to my GTBank account");
  assert.ok(i);
  assert.equal(i.amount, 7500);
  assert.equal(i.target, "gtbank");
});

test("handles the ways people write amounts", () => {
  assert.equal(parseAmount("send ₦7,500"), 7500);
  assert.equal(parseAmount("send 7500"), 7500);
  assert.equal(parseAmount("send 7.5k"), 7500);
  assert.equal(parseAmount("send 50 thousand"), 50000);
  assert.equal(parseAmount("send $20"), 20);
  assert.equal(parseAmount("send 1.5 million"), 1_500_000);
});

test("an account number is not an amount", () => {
  // 10-digit NUBAN must not be read as ₦123,456,789.
  assert.equal(parseAmount("account 0123456789"), null);
});

test("finds a @username destination", () => {
  assert.equal(parseTarget("send 500 to @kola"), "@kola");
  assert.equal(parseTransferIntent("ttip 500 to @kola")?.target, "@kola");
});

test("a question about transfers is NOT an instruction to transfer", () => {
  for (const q of [
    "how do I transfer 5000 to my bank",
    "what does it cost to send 5000",
    "can I withdraw 20000 today",
    "why is my transfer of 3000 pending",
    "what is the fee to transfer 1000",
  ]) {
    assert.equal(parseTransferIntent(q), null, `should not be an instruction: ${q}`);
  }
});

test("a verb with no amount is not a transfer", () => {
  assert.equal(parseTransferIntent("I want to send money"), null);
  assert.equal(parseTransferIntent("transfer to my bank"), null);
});

test("an amount with no verb is not a transfer", () => {
  assert.equal(parseTransferIntent("my balance is 7500"), null);
  assert.equal(parseTransferIntent("7500"), null);
});

test("ordinary questions are never read as instructions", () => {
  for (const q of ["what are your fees", "hello", "what is ttip", "my transfer is pending"]) {
    assert.equal(parseTransferIntent(q), null, `misread: ${q}`);
  }
});

test("a missing destination still parses — the app asks for it", () => {
  const i = parseTransferIntent("send 2000");
  assert.ok(i);
  assert.equal(i.amount, 2000);
  assert.equal(i.target, null);
});
