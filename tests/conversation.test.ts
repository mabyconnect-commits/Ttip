import test from "node:test";
import assert from "node:assert/strict";
import { conversationMessages, type Turn } from "../src/lib/assistant/conversation";

/**
 * Ada on Telegram gets one HTTP request per message, so this array IS her
 * memory. Two things must hold: the API must accept it (roles alternate, the
 * user speaks first and last), and the transfer context must survive — the
 * whole bug being fixed is her asking who to pay after already being told.
 */

const u = (text: string): Turn => ({ role: "user", text });
const a = (text: string): Turn => ({ role: "assistant", text });

/** What the API itself requires. */
function assertValid(msgs: { role: string; content: string }[]) {
  assert.ok(msgs.length > 0, "no messages");
  assert.equal(msgs[0].role, "user", "must open with the user");
  assert.equal(msgs[msgs.length - 1].role, "user", "must end with the user");
  for (let i = 1; i < msgs.length; i++) {
    assert.notEqual(msgs[i].role, msgs[i - 1].role, `roles repeat at ${i}`);
  }
  for (const m of msgs) assert.ok(m.content.trim(), "empty message");
}

test("the conversation is passed through in order", () => {
  const msgs = conversationMessages(
    [u("send money to 9136214038 Moniepoint"), a("Got it — how much?"), u("1,200")],
    "1,200",
  );
  assertValid(msgs);
  assert.equal(msgs.length, 3);
  assert.match(msgs[0].content, /9136214038/);
  assert.equal(msgs[2].content, "1,200");
});

test("the account survives to the answer — the bug this fixes", () => {
  // She was told the account, asked how much, and was told. She must not be
  // able to ask who again: the number is right there in the history.
  const msgs = conversationMessages(
    [u("send money to this account 9136214038, Moniepoint"), a("Got it — **9136214038** at **Moniepoint**.\n\nHow much should I send?"), u("send one five")],
    "send one five",
  );
  assertValid(msgs);
  assert.ok(msgs.some((m) => m.content.includes("9136214038")));
});

test("several answers in a row are merged, not sent as repeats", () => {
  // Setting up a transfer, Ada speaks twice with nothing in between. Sent as
  // two assistant messages the API rejects the call outright.
  const msgs = conversationMessages(
    [u("hi"), a("Hello"), a("I heard: send 5k"), u("yes")],
    "yes",
  );
  assertValid(msgs);
  assert.equal(msgs.length, 3);
  assert.match(msgs[1].content, /Hello\nI heard: send 5k/);
});

test("a window that opens on an answer keeps it", () => {
  // A photo produces an answer with no typed question in front of it, and that
  // answer holds the account number. Dropping it loses exactly what matters.
  const msgs = conversationMessages(
    [a("Got it — **9136214038** at **Moniepoint**. How much should I send?"), u("1200")],
    "1200",
  );
  assertValid(msgs);
  assert.ok(msgs.some((m) => m.content.includes("9136214038")));
});

test("the current question is never duplicated", () => {
  const msgs = conversationMessages([u("what's my balance")], "what's my balance");
  assert.deepEqual(msgs, [{ role: "user", content: "what's my balance" }]);
});

test("a question not yet recorded is still asked", () => {
  // Recording is best-effort; if the write failed, the model must still be
  // given the question rather than being asked to answer the last reply.
  const msgs = conversationMessages([u("hi"), a("Hello")], "what are your fees");
  assertValid(msgs);
  assert.equal(msgs[msgs.length - 1].content, "what are your fees");
});

test("an empty history is just the question", () => {
  const msgs = conversationMessages([], "what's my limit");
  assertValid(msgs);
  assert.deepEqual(msgs, [{ role: "user", content: "what's my limit" }]);
});

test("blank turns are dropped rather than sent", () => {
  const msgs = conversationMessages([u("  "), a("Hello"), u("")], "hi again");
  assertValid(msgs);
});

test("with no question, it never ends on an answer", () => {
  assert.deepEqual(conversationMessages([a("Hello")], ""), []);
  const msgs = conversationMessages([u("hi"), a("Hello")], "");
  assert.deepEqual(msgs, [{ role: "user", content: "hi" }]);
});
