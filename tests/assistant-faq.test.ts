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
  // The rule is "never guess". Where the guess would be about money, that
  // means handing over to a human; where the question isn't about money at
  // all, paging support would just bury the real problems in the same inbox.
  const money = answerFaq("someone took ₦30,000 from my balance and i did not authorise it");
  assert.equal(money.escalate, true);
  assert.ok(money.text.includes("@"), "should hand over an email address");

  const idle = answerFaq("what is the airspeed velocity of an unladen swallow");
  assert.equal(idle.escalate, false);
  assert.ok(!/\d/.test(idle.text.replace(/24\/7/g, "")), "must not invent a figure");
});

test("never invents an answer for an empty question", () => {
  assert.equal(answerFaq("").escalate, false);
});

test("the brand name in a question doesn't hijack the answer", () => {
  // "Whats Ttip all about?" was answered with the peer-to-peer transfer
  // instructions, because "ttip" was a match phrase and the brand name appears
  // in almost every question anyone asks.
  for (const q of ["Whats Ttip all about please?", "what is ttip", "how does ttip work", "tell me about ttip"]) {
    const a = answerFaq(q).text;
    assert.ok(a.includes("crypto into spendable cash"), `wrong answer for: ${q}`);
    assert.ok(!a.startsWith("Tap Ttip, enter their"), `still the transfer answer for: ${q}`);
  }
});

test("the transfer answer still wins when that's what was asked", () => {
  for (const q of ["how do I tip someone", "how do I send money to a friend", "can I ttip someone"]) {
    assert.ok(answerFaq(q).text.startsWith("Tap Ttip"), `should be the transfer answer: ${q}`);
  }
});

test("phrases match whole words only", () => {
  // "limit" must not fire on a word that merely contains it — the answer must
  // not be the withdrawal-limits one.
  const a = answerFaq("is there a delimiter in the reference?");
  assert.ok(!/per transfer|per rolling|tier/i.test(a.text), a.text);
});

test("a two-letter first name is treated as a title, not a name", () => {
  assert.ok(answerFaq("hi", { name: "Mr" }).text.startsWith("Hi — "));
  assert.ok(answerFaq("hi", { name: "Kola Adeyemi" }).text.startsWith("Hi Kola"));
});

test("the deposit answer quotes money, never a percentage", () => {
  // A rate quoted at the moment someone is trying to GIVE us money reads like a
  // tax on their own cash and puts people off funding at all. The charge is
  // tens of naira — say that instead.
  for (const q of ["how do I deposit", "how do I add money", "how do I fund my account", "how do I top up"]) {
    const a = answerFaq(q).text;
    assert.ok(!/\d\s*%/.test(a), `percentage leaked into the deposit answer: ${q} → ${a}`);
    assert.ok(/₦|free/i.test(a), `deposit fee not stated in money: ${q} → ${a}`);
  }
});

test("Ada knows who she is, and it never becomes a support ticket", () => {
  // Asked "What's your name please?", she answered "I'm not sure about that
  // one… email the team" — and paged a human about her own name.
  for (const q of [
    "Whats your Name please?",
    "who are you",
    "are you a bot",
    "are you a bro or a girl?",
    "boy or girl",
  ]) {
    const a = answerFaq(q, {});
    assert.equal(a.escalate, false, q);
    assert.match(a.text, /I'm Ada/i, q);
  }
});

test("smalltalk is answered, money questions still reach a human", () => {
  // Escalating everything put "how are you?" in the support inbox next to real
  // problems, which is how a real problem gets missed.
  for (const chat of ["how are you doing bro", "tell me a joke", "what's the weather"]) {
    assert.equal(answerFaq(chat, {}).escalate, false, chat);
  }
  for (const real of [
    "why did my ₦30,000 fail",
    "where is the money i sent yesterday",
    "my account is blocked",
    "someone scammed me",
  ]) {
    assert.equal(answerFaq(real, {}).escalate, true, real);
  }
});
