import test from "node:test";
import assert from "node:assert/strict";
import { cleanNarration, payoutNarration, NARRATION_MAX } from "../src/lib/narration";

/**
 * The narration lands on the recipient's bank statement. Bank rails are fussy
 * about it, and a rejection from the RECEIVING bank is the worst place to find
 * out — so it's cleaned here, and truncated rather than failed.
 */

test("keeps an ordinary description intact", () => {
  assert.equal(cleanNarration("Rent for March"), "Rent for March");
  assert.equal(cleanNarration("Invoice 204 - goods"), "Invoice 204 - goods");
});

test("strips characters the rails choke on", () => {
  assert.equal(cleanNarration("payment 💸 for @kola!"), "payment for kola");
  assert.equal(cleanNarration("rent\nfor\tMarch"), "rent for March");
});

test("truncates instead of failing", () => {
  const long = "a".repeat(500);
  assert.equal(cleanNarration(long).length, NARRATION_MAX);
});

test("collapses whitespace and trims", () => {
  assert.equal(cleanNarration("   rent    March   "), "rent March");
});

test("empty input never reaches the bank as an empty field", () => {
  // Some banks reject a blank narration outright.
  assert.equal(payoutNarration(""), "Ttip payout");
  assert.equal(payoutNarration(null), "Ttip payout");
  assert.equal(payoutNarration("💸💸"), "Ttip payout", "nothing survives cleaning → fall back");
});

test("a real description is used, not the fallback", () => {
  assert.equal(payoutNarration("school fees"), "school fees");
});
