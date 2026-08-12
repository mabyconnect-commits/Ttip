import { test } from "node:test";
import assert from "node:assert/strict";
import { scaleUnits } from "../src/lib/settlement/deposit-amount";
import { parseDextopusDeposit } from "../src/lib/settlement/webhook";

/**
 * The production numbers, pinned.
 *
 * Dextopus reports settlement amounts in BASE UNITS — confirmed against the
 * Sweepflow reference integration, which runs every figure through
 * formatAmount(raw, decimals). Crediting the integer is what produced
 * 725,902 USDC for a deposit worth 73 cents, and ten quintillion USDT for
 * 10.29 tokens.
 */

test("725,902 base units of USDC is 0.725902 USDC", () => {
  assert.equal(scaleUnits("725902", 6), 0.725902);
});

test("the ten-quintillion case: 18 decimals, past what a JS number holds", () => {
  // 1.029e19 is beyond Number.MAX_SAFE_INTEGER, so this MUST go through BigInt.
  assert.equal(scaleUnits("10290000000000000000", 18), 10.29);
  assert.ok(1.029e19 > Number.MAX_SAFE_INTEGER, "the value really is past safe range");
});

test("2.4 SOL at nine decimals", () => {
  assert.equal(scaleUnits("2400000000", 9), 2.4);
});

test("nonsense never becomes a balance", () => {
  assert.equal(scaleUnits("not-a-number", 6), null);
  assert.equal(scaleUnits("0", 6), null);
  assert.equal(scaleUnits("-5", 6), null);
  assert.equal(scaleUnits("100", -1), null);
});

test("a formatted amount is used as-is and never marked raw", () => {
  const d = parseDextopusDeposit({
    event: "deposit.completed",
    data: {
      requestId: "req_1",
      depositAddress: "So1anaAddr",
      settlementAsset: "USDC",
      settlementAmountFormatted: 0.725902,
      settlementAmount: "725902",
      originChainId: 792703809,
      status: "COMPLETED",
    },
  });
  assert.equal(d.amount, 0.725902);
  assert.equal(d.amountIsRaw, false);
});

test("without a formatted field the amount is flagged as base units", () => {
  // The exact shape that caused the incident. It must NOT be creditable as-is.
  const d = parseDextopusDeposit({
    event: "deposit.completed",
    data: {
      requestId: "req_2",
      depositAddress: "So1anaAddr",
      settlementAsset: "USDC",
      settlementAmount: "725902",
      originChainId: 792703809,
      status: "COMPLETED",
    },
  });
  assert.equal(d.amountIsRaw, true);
  assert.equal(d.rawAmount, "725902");
  // And the raw string is preserved exactly, so BigInt scaling stays exact.
  assert.equal(scaleUnits(d.rawAmount!, 6), 0.725902);
});

test("a big raw amount survives the parse without losing precision", () => {
  const d = parseDextopusDeposit({
    event: "deposit.completed",
    data: {
      requestId: "req_3",
      depositAddress: "0xabc",
      settlementAsset: "USDT",
      settlementAmount: "10290000000000000000",
      originChainId: 56,
      status: "COMPLETED",
    },
  });
  assert.equal(d.rawAmount, "10290000000000000000");
  assert.equal(scaleUnits(d.rawAmount!, 18), 10.29);
});
