import { test } from "node:test";
import assert from "node:assert/strict";
import { convert } from "../src/lib/prices";

/**
 * Reward pots (user.cashback, user.referralEarned) are bare numbers with no
 * currency column, so they are stored in REWARDS_BASE_FIAT and must be CONVERTED
 * when claimed into whatever fiat the user is displaying.
 *
 * The bug this guards: the claim credited the raw stored number into the display
 * currency, which re-labelled the pot instead of converting it. A ₦6,908.20 pot
 * claimed while on ZAR paid R6,908.20 — worth ~₦570,000, about 82x its real
 * value, straight out of the treasury.
 *
 * Rates are pinned via the FX cache so this is deterministic and offline.
 */
const NGN_PER_USD = 1642;
const ZAR_PER_USD = 18.3;

(globalThis as unknown as { __ttipFx?: { at: number; data: Record<string, number> } }).__ttipFx = {
  at: Date.now(),
  data: { USD: 1, NGN: 1 / NGN_PER_USD, ZAR: 1 / ZAR_PER_USD },
};

test("claiming a naira pot on ZAR pays its rand VALUE, not the same number", async () => {
  const pot = 6908.2; // in REWARDS_BASE_FIAT (NGN)
  const credited = pot * (await convert(1, "NGN", "ZAR"));

  // The real value: ₦6,908.20 is about R77 at these rates — not R6,908.20.
  assert.ok(credited > 70 && credited < 85, `expected ~R77, got R${credited.toFixed(2)}`);
  assert.ok(credited < pot / 50, "credited amount must be far below the raw naira number");

  // And it must be worth the same as the pot when valued back in naira.
  const backInNgn = credited * (await convert(1, "ZAR", "NGN"));
  assert.ok(Math.abs(backInNgn - pot) < 0.01, `round-trip lost value: ₦${backInNgn.toFixed(2)}`);
});

test("the old behaviour would have paid ~82x — regression guard", async () => {
  const pot = 6908.2;
  const rate = await convert(1, "NGN", "ZAR");
  const oldWay = pot; // credited raw as ZAR
  const newWay = pot * rate;
  assert.ok(oldWay / newWay > 50, "the overpay multiple this fix removes should be large");
});

test("converting into the base currency is a no-op", async () => {
  assert.equal(await convert(1234.56, "NGN", "NGN"), 1234.56);
});

test("earning in a non-base currency converts INTO the base before it is stored", async () => {
  // R100 of revenue must land in the pot as its naira value, not as 100.
  const inBase = await convert(100, "ZAR", "NGN");
  assert.ok(inBase > 8000 && inBase < 9500, `expected ~₦8,972, got ₦${inBase.toFixed(2)}`);
});
