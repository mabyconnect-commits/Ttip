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

/* ---- bills: "Ada buy me ₦100 airtime", "send 1GB to my MTN line" ---- */

import { parseBillIntent, parseDataSize, parsePhone } from "../src/lib/assistant/intent";

test("reads an airtime purchase", () => {
  const i = parseBillIntent("Ada buy me 100 naira airtime");
  assert.ok(i);
  assert.equal(i.category, "airtime");
  assert.equal(i.amountNgn, 100);
});

test("reads a data purchase with a network", () => {
  const i = parseBillIntent("send 100mb to my MTN line");
  assert.ok(i);
  assert.equal(i.category, "data");
  assert.equal(i.sizeMb, 100);
  assert.equal(i.network, "MTN");
});

test("understands the ways data sizes are written", () => {
  assert.equal(parseDataSize("1gb"), 1024);
  assert.equal(parseDataSize("1.5 GB"), 1536);
  assert.equal(parseDataSize("500mb"), 500);
  assert.equal(parseDataSize("no size here"), undefined);
});

test("reads a Nigerian number in any shape", () => {
  assert.equal(parsePhone("send to 08113866493"), "08113866493");
  assert.equal(parsePhone("send to +2348113866493"), "08113866493");
  assert.equal(parsePhone("send to 2348113866493"), "08113866493");
});

test("a phone number is never mistaken for the airtime amount", () => {
  // 08113866493 must not be read as ₦8,113,866,493.
  const i = parseBillIntent("buy 200 airtime for 08113866493");
  assert.ok(i);
  assert.equal(i.amountNgn, 200);
  assert.equal(i.phone, "08113866493");
});

test("questions about airtime are not purchase instructions", () => {
  for (const q of ["how much is 1gb of data", "what does airtime cost", "why did my airtime fail"]) {
    assert.equal(parseBillIntent(q), null, `misread: ${q}`);
  }
});

test("a statement about data is not an order", () => {
  assert.equal(parseBillIntent("my data finished"), null);
  assert.equal(parseBillIntent("I have no airtime"), null);
});

test("every network is recognised", () => {
  for (const [text, net] of [["buy 1gb glo data", "Glo"], ["buy 1gb airtel data", "Airtel"], ["buy 1gb 9mobile data", "9mobile"], ["buy 1gb etisalat data", "9mobile"]] as const) {
    assert.equal(parseBillIntent(text)?.network, net, text);
  }
});

/* ---- pasting an account number straight into the chat ---- */

import { parseAccountNumber, parseBankName } from "../src/lib/assistant/intent";

test("reads an account number pasted into the message", () => {
  // The market case: photograph a vendor's account, paste it, send.
  const i = parseTransferIntent("send 5k to this account 0123456789");
  assert.ok(i);
  assert.equal(i.amount, 5000);
  assert.equal(i.account, "0123456789");
});

test("a pasted account number is never read as the amount", () => {
  const i = parseTransferIntent("send 5000 to 0123456789");
  assert.ok(i);
  assert.equal(i.amount, 5000, "0123456789 must not become the amount");
  assert.equal(i.account, "0123456789");
});

test("an 11-digit phone number is not an account number", () => {
  assert.equal(parseAccountNumber("send to 08113866493"), undefined);
});

test("a bank named alongside the number is picked up", () => {
  const banks = ["Opay (Paycom)", "GTBank", "Access Bank", "Kuda Bank"];
  assert.equal(parseBankName("send 5000 to 0123456789 opay", banks), "Opay (Paycom)");
  assert.equal(parseBankName("send 5000 to 0123456789 kuda", banks), "Kuda Bank");
  assert.equal(parseBankName("send 5000 to 0123456789", banks), undefined);
});
