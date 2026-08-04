import test from "node:test";
import assert from "node:assert/strict";
import { fillFromReply, draftGap, type DraftState } from "../src/lib/assistant/draft-fill";
import { transferParts, parseBankName } from "../src/lib/assistant/intent";
import { NIGERIAN_BANKS } from "../src/lib/banks";

/**
 * A transfer arrives a piece at a time, and every piece has to land.
 *
 * These walk real conversations rather than testing the parser twice: the bug
 * this replaces was never in a parser, it was in what the app did with what the
 * parser gave it — it asked a question and remembered nothing, so the answer
 * had nowhere to go and Ada asked again.
 */

const NAMES = NIGERIAN_BANKS.map((b) => b.name);
const fill = (d: DraftState, text: string) => fillFromReply(d, text, NAMES);

/** Apply what a message adds, the way the webhook does. */
function apply(d: DraftState, text: string): DraftState {
  const add = fill(d, text);
  return {
    ...d,
    bankName: add.bank ?? d.bankName,
    amount: add.amount ?? d.amount,
  };
}

test("the conversation that used to go in circles now finishes", () => {
  // Verbatim from a chat: a voice note, then the amount. It ended with Ada
  // saying "send it as one line so the parser picks it up".
  const first = "Send money to this account number 9136214038. Money point. Money point.";
  const parts = transferParts(first);
  assert.equal(parts?.account, "9136214038");

  let d: DraftState = {
    kind: "bank",
    amount: null,
    accountNumber: parts!.account!,
    bankName: parseBankName(first, NAMES) ?? null,
  };
  assert.match(d.bankName ?? "", /Moniepoint/);
  assert.equal(draftGap(d), "amount");

  d = apply(d, "I mean 1,500.");
  assert.equal(d.amount, 1500);
  assert.equal(draftGap(d), null, "should be ready to confirm");
});

test("the pieces can arrive in any order", () => {
  // Account first, bank second, amount third — one per message.
  let d: DraftState = { kind: "bank", amount: null, accountNumber: "9136214038", bankName: null };
  assert.equal(draftGap(d), "bank");

  d = apply(d, "Money points.");
  assert.match(d.bankName ?? "", /Moniepoint/);
  assert.equal(draftGap(d), "amount");

  d = apply(d, "1,500");
  assert.equal(d.amount, 1500);
  assert.equal(draftGap(d), null);
});

test("amount first, bank second works just as well", () => {
  let d: DraftState = { kind: "bank", amount: null, accountNumber: "9077984753", bankName: null };
  d = apply(d, "5k");
  assert.equal(d.amount, 5000);
  assert.equal(draftGap(d), "bank");

  d = apply(d, "opay");
  assert.match(d.bankName ?? "", /Opay/);
  assert.equal(draftGap(d), null);
});

test("one message carrying both is taken whole", () => {
  const d = apply({ kind: "bank", amount: null, accountNumber: "9077984753", bankName: null }, "gt bank, 2,500");
  assert.match(d.bankName ?? "", /Guaranty Trust/);
  assert.equal(d.amount, 2500);
  assert.equal(draftGap(d), null);
});

test("a question is not an answer", () => {
  // "What's 1000 naira in dollars" while a transfer is half-built must not
  // become a ₦1,000 transfer.
  const d: DraftState = { kind: "bank", amount: null, accountNumber: "9077984753", bankName: "Opay (Paycom)" };
  assert.deepEqual(fill(d, "what is 1000 naira in dollars"), {});
  assert.deepEqual(fill(d, "how much is your fee"), {});
  assert.deepEqual(fill(d, "why is my transfer pending"), {});
});

test("nothing is added by a message that adds nothing", () => {
  const d: DraftState = { kind: "bank", amount: null, accountNumber: "9077984753", bankName: "Opay (Paycom)" };
  assert.deepEqual(fill(d, "ok"), {});
  assert.deepEqual(fill(d, "thanks"), {});
  assert.deepEqual(fill(d, ""), {});
});

test("a piece already known is never overwritten", () => {
  // The amount is settled; a later mention of another number must not silently
  // change what is about to be sent.
  const d: DraftState = { kind: "bank", amount: 1500, accountNumber: "9077984753", bankName: "Opay (Paycom)" };
  assert.deepEqual(fill(d, "make it 9,000 instead"), {});
  assert.equal(draftGap(d), null);
});

test("a crypto draft waits only on the amount", () => {
  const d: DraftState = { kind: "crypto", amount: null, accountNumber: null, bankName: null };
  assert.equal(draftGap(d), "amount", "a chain has no bank to ask for");
  // A bank name in a crypto message means nothing and must not be recorded.
  assert.deepEqual(fill(d, "opay"), {});
  assert.equal(fill(d, "0.5").amount, 0.5);
});

test("an account number is not mistaken for an amount", () => {
  const d: DraftState = { kind: "bank", amount: null, accountNumber: "9136214038", bankName: "Opay (Paycom)" };
  assert.deepEqual(fill(d, "9136214038"), {});
});
