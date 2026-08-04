import test from "node:test";
import assert from "node:assert/strict";
import { cleanAssistantText, ESCALATE_MARKER } from "../src/lib/assistant/sanitize";
import { SWAP_FEE_PCT } from "../src/lib/constants";
import {
  ttipKnowledge,
  assistantRules,
  supportedPayoutCurrencies,
  comingSoonCurrencies,
} from "../src/lib/assistant/knowledge";

test("strips a complete function-call block from the visible answer", () => {
  // This is the exact leak seen in a competing app's chat window.
  const raw =
    'Sure, I can add you.\n<function=join_waitlist>{"name": "your name", "contact": "your contact info"}</function>\nAnything else?';
  const { text } = cleanAssistantText(raw);
  assert.ok(!text.includes("<function"));
  assert.ok(!text.includes("join_waitlist"));
  assert.ok(text.includes("Sure, I can add you."));
  assert.ok(text.includes("Anything else?"));
});

test("strips an unterminated call block (truncated stream)", () => {
  const { text } = cleanAssistantText('Let me check.\n<function=lookup>{"ref": "ABC');
  assert.equal(text, "Let me check.");
});

test("strips lone tags and thinking blocks", () => {
  assert.equal(cleanAssistantText("Hello <b>there</b>").text, "Hello there");
  assert.equal(cleanAssistantText("<thinking>hmm</thinking>Answer.").text, "Answer.");
  assert.equal(cleanAssistantText("<invoke name='x'>y</invoke>Done").text, "Done");
});

test("holds back a tag split across stream chunks", () => {
  // Chunk boundary lands mid-tag: nothing tag-shaped may be shown, even briefly.
  assert.equal(cleanAssistantText("Your fee is ₦60. <fun", true).text, "Your fee is ₦60. ");
  assert.equal(cleanAssistantText("Your fee is ₦60. <function=x>{}</function>", true).text, "Your fee is ₦60. ");
});

test("leaves ordinary maths and punctuation alone", () => {
  const raw = "If 5 < 10 you pay ₦25, and A > B means nothing here.";
  assert.equal(cleanAssistantText(raw).text, raw);
});

test("escalation marker is detected and never rendered", () => {
  const { text, escalate } = cleanAssistantText(`I can't see that transfer.\n${ESCALATE_MARKER}`);
  assert.equal(escalate, true);
  assert.ok(!text.includes("ESCALATE"));
  assert.equal(text, "I can't see that transfer.");
});

test("no escalation marker means no hand-over button", () => {
  assert.equal(cleanAssistantText("Your first 3 swaps each day are free.").escalate, false);
});

test("knowledge quotes the live fee schedule, not hardcoded numbers", () => {
  const k = ttipKnowledge();
  // ₦10 provider cost + 20% markup, rounded up = ₦12 on a small transfer.
  assert.ok(k.includes("₦12"), "small-transfer NGN fee missing");
  // Derived, not typed out — this test exists to catch hardcoded fees, so
  // hardcoding one here is how it silently stops doing its job.
  assert.ok(k.includes(`${(SWAP_FEE_PCT * 100).toFixed(1)}%`), "swap fee missing");
  assert.ok(k.includes("₦5,000"), "cashback claim threshold missing");
  assert.ok(k.includes("25%"), "referral share missing");
});

test("knowledge lists only payable currencies as payable", () => {
  const supported = supportedPayoutCurrencies();
  const soon = comingSoonCurrencies();
  assert.ok(supported.includes("NGN"));
  // Ttip cannot settle these to a bank — Ada must not say it can.
  for (const code of ["ZMW", "XOF", "XAF"]) {
    assert.ok(!supported.includes(code), `${code} must not be listed as payable`);
    assert.ok(soon.includes(code), `${code} should be listed as coming soon`);
  }
});

test("knowledge carries the tier ladder the server actually enforces", () => {
  const k = ttipKnowledge();
  assert.ok(k.includes("₦100,000 per transfer"), "Tier 1 per-transfer limit missing");
  assert.ok(k.includes("₦500,000 per rolling 24 hours"), "Tier 1 daily limit missing");
  assert.ok(k.includes("₦2,000,000 per transfer"), "Tier 2 per-transfer limit missing");
});

test("knowledge names every alias of the partner bank", () => {
  const k = ttipKnowledge();
  for (const name of ["Flutterwave MFB", "OK MFB", "Orokam"]) {
    assert.ok(k.includes(name), `${name} missing — users can't find the bank`);
  }
});

test("rules forbid credentials and markup", () => {
  const r = assistantRules().toLowerCase();
  assert.ok(r.includes("pin"));
  assert.ok(r.includes("seed"));
  assert.ok(r.includes("cannot"));
  assert.ok(r.includes("never emit xml"));
});

test("rules tell the model it CAN prepare a transfer", () => {
  // It was told "you have no buttons", so it answered "I can't move money" to
  // someone asking for help with a transfer — while the app could do it.
  const r = assistantRules();
  assert.ok(/you can set up a bank transfer/i.test(r), "must describe the real capability");
  // The prompt is wrapped, so compare on collapsed whitespace.
  const flat = r.replace(/\s+/g, " ");
  assert.ok(/never say you can.t help with a transfer/i.test(flat));
  // …but still can't execute one on its own.
  assert.ok(/confirm with their transaction pin/i.test(r));
});

test("knowledge says a payout is funded from every wallet, never after a swap", () => {
  // Ada told someone holding USDT that they "may need to swap some to NGN
  // first for it to go through". The app has never required that — it spreads
  // a payout across every wallet (see lib/funding-plan.ts) — so the advice
  // invented a step and cost the user a swap they didn't need.
  const flat = ttipKnowledge().replace(/\s+/g, " ");
  assert.ok(/funded from EVERYTHING they hold/i.test(flat), "must state multi-wallet funding");
  assert.ok(/never tell anyone to swap to naira first/i.test(flat), "must forbid the invented step");
  // And affordability is judged on the total, not on one balance.
  assert.ok(/TOTAL spendable/i.test(flat));
});

test("the rules never ask a user to re-type a request in a set format", () => {
  // "Send it as one line so the parser picks it up" — the app takes the pieces
  // in any order, so this was asking the user to do the app's job.
  const flat = assistantRules().replace(/\s+/g, " ");
  assert.ok(/never ask anyone to re-type/i.test(flat), "must forbid asking for a prescribed sentence");
  // The phrase may only appear as an example of what not to say.
  const mentions = flat.match(/as one line/gi) ?? [];
  assert.equal(mentions.length, 1, "should survive only inside the prohibition");
  assert.ok(/no "say it as one line"/i.test(flat));
});

test("Ada knows her own name is not a payee", () => {
  // "Do it for Ada" means "Ada, do it". She answered "I'm flattered, but I
  // don't have an account of my own — if 'Ada' is someone you want to pay…",
  // turning an instruction into a question about a person who doesn't exist.
  const flat = assistantRules().replace(/\s+/g, " ");
  assert.ok(/that is YOU being spoken to/i.test(flat), "must claim the name");
  assert.ok(/never offer to send money to/i.test(flat));
  assert.ok(/no account, no wallet and no balance of your own/i.test(flat));
});

test("Ada never announces a confirmation she cannot produce", () => {
  // "Sending ₦1,500 now… the confirmation should come up for your PIN" — she
  // can't make either true, and the user sits watching a chat believing their
  // money is moving.
  const flat = assistantRules().replace(/\s+/g, " ");
  assert.ok(/Nor may you announce one that is on its way/i.test(flat));
  assert.ok(/saying "send it" or "go ahead" is what brings the confirmation up/i.test(flat));
});
