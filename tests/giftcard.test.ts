import { test } from "node:test";
import assert from "node:assert/strict";

process.env.AUTH_SECRET ||= "test-secret-that-is-long-enough";

import { giftCardPrice, giftCardMarkup } from "../src/lib/settlement/giftcard";
import { sealCode, openCode, codeHint } from "../src/lib/giftcard-secret";

test("a card is priced above what the distributor charges us", () => {
  // Bought at 94% of face, sold at 97% with the default 3-point markup.
  assert.equal(giftCardPrice(100, 0.94), 97);
  assert.equal(giftCardPrice(25, 0.94), 24.25);
});

test("the price never dips below our cost", () => {
  // A distributor with no discount at all: we charge face value, not less.
  assert.equal(giftCardPrice(50, 1), 50);
  // And a nonsense rate falls back to face value rather than selling at a loss.
  assert.equal(giftCardPrice(50, 0), 50);
  assert.equal(giftCardPrice(50, Number.NaN), 50);
  assert.equal(giftCardPrice(50, -2), 50);
});

test("the price never exceeds face value", () => {
  // Selling a $10 card for more than $10 is worse than not selling it — nobody
  // would buy, and it would look like a scam.
  assert.ok(giftCardPrice(10, 0.99) <= 10);
});

test("a blank markup env var means the default, not zero", () => {
  const before = process.env.GIFTCARD_MARKUP_PCT;
  process.env.GIFTCARD_MARKUP_PCT = "";
  assert.equal(giftCardMarkup(), 0.03);
  process.env.GIFTCARD_MARKUP_PCT = "not a number";
  assert.equal(giftCardMarkup(), 0.03);
  process.env.GIFTCARD_MARKUP_PCT = "0.05";
  assert.equal(giftCardMarkup(), 0.05);
  if (before === undefined) delete process.env.GIFTCARD_MARKUP_PCT;
  else process.env.GIFTCARD_MARKUP_PCT = before;
});

test("a sealed code comes back exactly, and never in the clear", () => {
  const code = "AMZN-4K2P-9QX7-1123";
  const sealed = sealCode(code);
  assert.notEqual(sealed, code);
  assert.ok(!sealed.includes("AMZN"));
  assert.equal(openCode(sealed), code);
});

test("the same code seals differently every time", () => {
  // A deterministic ciphertext would let anyone with the table spot two users
  // holding the same card.
  assert.notEqual(sealCode("SAME-CODE-1234"), sealCode("SAME-CODE-1234"));
});

test("a tampered or unreadable code returns null instead of rubbish", () => {
  const sealed = sealCode("PSN-1111-2222-3333");
  const [iv, tag, enc] = sealed.split(".");
  // Flip a byte of the ciphertext — GCM must reject it rather than decrypt.
  const bad = Buffer.from(enc, "base64url");
  bad[0] ^= 0xff;
  assert.equal(openCode([iv, tag, bad.toString("base64url")].join(".")), null);
  assert.equal(openCode("not-sealed"), null);
  assert.equal(openCode(""), null);
  assert.equal(openCode(null), null);
});

test("the hint shows the last four and nothing else", () => {
  assert.equal(codeHint("AMZN-4K2P-9QX7-1123"), "••••1123");
  assert.equal(codeHint("12 34 56 78"), "••••5678");
  assert.equal(codeHint("123"), "••••");
});
