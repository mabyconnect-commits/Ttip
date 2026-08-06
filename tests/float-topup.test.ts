import test from "node:test";
import assert from "node:assert/strict";

/**
 * Sizing a float top-up, and how long a payout may wait.
 *
 * The numbers here decide whether someone sending $10,000 to a Nigerian bank
 * gets their money or gets it back. Both are acceptable outcomes; hanging
 * forever is not, which is why the window is enforced rather than suggested.
 *
 * Loaded dynamically so the module's `import "server-only"` doesn't fire before
 * the env is set for each case.
 */
async function float() {
  return import("../src/lib/settlement/float");
}

test("the top-up raises MORE than the shortfall", async () => {
  // A quote moves between sizing the trade and filling it. Raising exactly the
  // shortfall means coming back short and doing the whole thing again while
  // someone waits, so the default buffer is 10%.
  delete process.env.FLOAT_TOPUP_BUFFER_PCT;
  const { topupBuffer } = await float();
  assert.equal(topupBuffer(), 0.1);
  assert.equal(1_000_000 * (1 + topupBuffer()), 1_100_000);
});

test("the buffer is configurable, and nonsense is ignored", async () => {
  const { topupBuffer } = await float();
  for (const [set, want] of [["0.25", 0.25], ["0", 0], ["", 0.1], ["-1", 0.1], ["2", 0.1], ["abc", 0.1]] as const) {
    process.env.FLOAT_TOPUP_BUFFER_PCT = set as string;
    assert.equal(topupBuffer(), want, `FLOAT_TOPUP_BUFFER_PCT=${set}`);
  }
  delete process.env.FLOAT_TOPUP_BUFFER_PCT;
});

test("the hold window defaults to 20 minutes", async () => {
  delete process.env.PAYOUT_HOLD_MINUTES;
  const { holdWindowMinutes, holdWindowMs } = await float();
  assert.equal(holdWindowMinutes(), 20);
  assert.equal(holdWindowMs(), 20 * 60_000);
});

test("a window that isn't a sane number falls back rather than vanishing", async () => {
  // A zero or negative window would expire every payout the instant it was
  // held — refunding people who were about to be paid. A missing value must
  // never mean "no wait".
  const { holdWindowMinutes } = await float();
  for (const [set, want] of [["45", 45], ["1", 1], ["0", 20], ["-5", 20], ["999", 20], ["", 20]] as const) {
    process.env.PAYOUT_HOLD_MINUTES = set as string;
    assert.equal(holdWindowMinutes(), want, `PAYOUT_HOLD_MINUTES=${set}`);
  }
  delete process.env.PAYOUT_HOLD_MINUTES;
});
