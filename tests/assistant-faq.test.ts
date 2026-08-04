import test from "node:test";
import assert from "node:assert/strict";
import { answerFaq } from "../src/lib/assistant/faq";

/**
 * The assistant must work with no ANTHROPIC_API_KEY. Gating support chat on an
 * environment variable meant that until it was set there was no chat at all.
 */

test("answers the common questions without a model", () => {
  for (const q of [
    "how do I cash out to my bank?",
    "what are your fees",
    "how do I deposit",
    "tell me about cashback",
    "how does referral work",
    "I want to buy airtime",
    "how do I swap",
    "my transfer is still pending",
  ]) {
    const a = answerFaq(q);
    assert.equal(a.escalate, false, `should have answered: ${q}`);
    assert.ok(a.text.length > 40, `answer too thin: ${q}`);
  }
});

test("quotes the live fee schedule, never a hardcoded number", () => {
  // ₦10 provider cost + 20% markup, rounded up = ₦12 on a small transfer.
  assert.ok(answerFaq("what are your fees").text.includes("₦12"));
});

test("uses the signed-in user's real tier for a limits question", () => {
  const t1 = answerFaq("why can't I withdraw", { tier: 1 });
  assert.ok(t1.text.includes("Tier 1"));
  assert.ok(t1.text.includes("₦100,000"), "should quote the real per-transfer cap");

  const t2 = answerFaq("what is my limit", { tier: 2 });
  assert.ok(t2.text.includes("Tier 2"));
  assert.ok(!t2.text.includes("₦100,000 per transfer"), "must not quote Tier 1's cap to a Tier 2 user");
});

test("an unverified user is told the actual next step", () => {
  assert.ok(answerFaq("how do I raise my limits", { tier: 0 }).text.includes("BVN"));
  assert.ok(answerFaq("how do I raise my limits", { tier: 1 }).text.match(/NIN|passport/));
});

test("gives the user their own deposit account and its other bank names", () => {
  const a = answerFaq("how do I add money", {
    nairaAccount: "9901234567",
    nairaBank: "Flutterwave MFB",
    bankAliases: ["OK MFB", "Orokam MFB"],
  });
  assert.ok(a.text.includes("9901234567"));
  assert.ok(a.text.includes("OK MFB"), "must name the aliases — users can't find the bank otherwise");
});

test("the longest matching phrase wins", () => {
  // "can't withdraw" is a limits question, not a how-to-cash-out question.
  assert.ok(answerFaq("i can't withdraw my money", { tier: 1 }).text.includes("Tier 1"));
});

test("escalates instead of guessing when it doesn't know", () => {
  const a = answerFaq("what is the airspeed velocity of an unladen swallow");
  assert.equal(a.escalate, true);
  assert.ok(a.text.includes("@"), "should hand over an email address");
});

test("never invents an answer for an empty question", () => {
  assert.equal(answerFaq("").escalate, false);
});
