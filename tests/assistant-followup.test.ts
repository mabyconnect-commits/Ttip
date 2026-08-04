import test from "node:test";
import assert from "node:assert/strict";
import { parseFollowUpIntent } from "../src/lib/assistant/intent";

/**
 * Transfers built up over several messages.
 *
 * A user pasted an account, Ada asked how much, they replied "1000" — and
 * nothing was drafted, because a bare number has no verb. Ada then described
 * the transfer in prose and told them to "tap confirm and enter your PIN" when
 * no card had ever been rendered. They typed their PIN into the chat instead.
 *
 * These lock in both halves: the follow-up completes the transfer, and an
 * unrelated message never silently completes one.
 */

type Msg = { role: "user" | "assistant"; content: string };
const u = (content: string): Msg => ({ role: "user", content });
const a = (content: string): Msg => ({ role: "assistant", content });

test("the exact conversation that failed: account first, amount second", () => {
  const intent = parseFollowUpIntent([
    u("send to 9136214038 Moniepoint"),
    a("How much would you like to send?"),
    u("1000"),
  ]);
  assert.ok(intent, "no draft was created");
  assert.equal(intent!.amount, 1000);
  assert.equal(intent!.account, "9136214038");
  // The bank was typed a turn earlier, so it has to be in the merged text.
  assert.match(intent!.sourceText, /moniepoint/i);
});

test("the other way round: amount first, account second", () => {
  const intent = parseFollowUpIntent([
    u("I want to send 5000"),
    a("Which account should it go to?"),
    u("9077984753 Opay"),
  ]);
  assert.ok(intent, "no draft was created");
  assert.equal(intent!.amount, 5000);
  assert.equal(intent!.account, "9077984753");
});

test("a one-line request still works untouched", () => {
  const intent = parseFollowUpIntent([u("send 7500 to 9077984753 Opay")]);
  assert.ok(intent);
  assert.equal(intent!.amount, 7500);
  assert.equal(intent!.account, "9077984753");
});

test("₦ and k in the follow-up are understood", () => {
  for (const [said, expected] of [["₦1,000", 1000], ["2k", 2000], ["1000 naira", 1000]] as const) {
    const intent = parseFollowUpIntent([u("send to 9136214038 Moniepoint"), a("How much?"), u(said)]);
    assert.ok(intent, `no draft for "${said}"`);
    assert.equal(intent!.amount, expected, said);
  }
});

test("a question containing a number does NOT complete a transfer", () => {
  // The dangerous case: a stray number must not silently become a payment.
  for (const q of [
    "what is 1000 naira in dollars",
    "how much is 1000 naira worth today",
    "why did my 1000 transfer fail yesterday",
  ]) {
    const intent = parseFollowUpIntent([u("send to 9136214038 Moniepoint"), a("How much?"), u(q)]);
    assert.equal(intent, null, `built a transfer from: ${q}`);
  }
});

test("an unrelated later message can't re-fire a finished transfer", () => {
  const intent = parseFollowUpIntent([
    u("send 5000 to 9077984753 Opay"),
    a("Ready to send NGN 5,000…"),
    u("thanks"),
  ]);
  assert.equal(intent, null);
});

test("a message with no amount and no account is not a transfer", () => {
  assert.equal(parseFollowUpIntent([u("send to 9136214038 Opay"), a("How much?"), u("hello")]), null);
  assert.equal(parseFollowUpIntent([u("hi")]), null);
});

test("a follow-up with no earlier request is ignored", () => {
  assert.equal(parseFollowUpIntent([a("Hi, I'm Ada."), u("1000")]), null);
});

test("it only looks back a few turns, not across the whole thread", () => {
  const intent = parseFollowUpIntent([
    u("send to 9136214038 Moniepoint"),
    a("How much?"),
    u("what are your fees"),
    a("Bank transfer out is ₦12…"),
    u("how do I verify"),
    a("Add your BVN…"),
    u("what is my limit"),
    a("Tier 2…"),
    u("1000"),
  ]);
  assert.equal(intent, null, "reached back past the conversation window");
});

test("the last message wins when both mention an amount", () => {
  const intent = parseFollowUpIntent([
    u("send 5000 to 9077984753 Opay"),
    a("Ready to send NGN 5,000…"),
    u("2000"),
  ]);
  assert.ok(intent, "no draft was created");
  assert.equal(intent!.amount, 2000, "used the stale amount");
  assert.equal(intent!.account, "9077984753");
});
