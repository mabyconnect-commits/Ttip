import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestCorrection } from "../src/lib/settlement/deposit-reverse";

/**
 * The real numbers from production, pinned.
 *
 * A 0.01 SOL deposit settled to USDC and was credited as 725,902 — the raw
 * integer with the decimal point thrown away. 725902 / 10^6 is 0.725902 USDC,
 * about 73 cents, which is what 0.01 SOL is worth after cross-chain fees.
 */

test("725,902 USDC is 0.725902 USDC", () => {
  const fix = suggestCorrection({ asset: "USDC", amount: 725902, chain: null, raw: null });
  assert.ok(fix);
  assert.equal(fix.corrected, 0.725902);
});

test("the 18-decimal USDT case", () => {
  // 10.29 USDT on BNB Chain arrived as 10290000000000000000.
  const fix = suggestCorrection({ asset: "USDT", amount: 1.029e19, chain: "56", raw: null });
  assert.ok(fix);
  assert.equal(fix.corrected, 10.29);
});

test("USDT is six decimals everywhere except BNB Chain", () => {
  // The single most dangerous assumption in this whole area: same ticker,
  // different decimals, so the same bug looks mild on one chain and
  // astronomical on another.
  const tron = suggestCorrection({ asset: "USDT", amount: 2_000_000, chain: "728126428", raw: null });
  assert.equal(tron?.corrected, 2);
  const bsc = suggestCorrection({ asset: "USDT", amount: 2e18, chain: "56", raw: null });
  assert.equal(bsc?.corrected, 2);
});

test("the provider's own formatted figure wins over arithmetic", () => {
  // Exact beats derived. No assumption about decimals at all when the payload
  // kept the real number.
  const fix = suggestCorrection({
    asset: "USDC",
    amount: 725902,
    chain: null,
    raw: { data: { settlementAmountFormatted: 0.7259 } },
  });
  assert.equal(fix?.corrected, 0.7259);
  assert.match(fix!.basis, /provider/);
});

test("an asset we don't know refuses to guess", () => {
  // A wrong correction is a second mis-credit on top of the first.
  assert.equal(suggestCorrection({ asset: "WHATEVER", amount: 12345, chain: null, raw: null }), null);
});

test("SOL uses nine decimals", () => {
  const fix = suggestCorrection({ asset: "SOL", amount: 2_400_000_000, chain: null, raw: null });
  assert.equal(fix?.corrected, 2.4);
});
