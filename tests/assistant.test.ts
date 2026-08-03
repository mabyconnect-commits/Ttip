import test from "node:test";
import assert from "node:assert/strict";
import { cleanAssistantText, ESCALATE_MARKER } from "../src/lib/assistant/sanitize";
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
  assert.ok(k.includes("0.5%"), "swap fee missing");
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

test("rules forbid credentials, money movement and markup", () => {
  const r = assistantRules().toLowerCase();
  assert.ok(r.includes("pin"));
  assert.ok(r.includes("seed"));
  assert.ok(r.includes("cannot"));
  assert.ok(r.includes("never emit xml"));
});
