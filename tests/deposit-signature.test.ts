import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";

import { verifyDextopusSignature } from "../src/lib/settlement/webhook";

// Read inside the function, not at module load, so setting it here is enough.
process.env.DEXTOPUS_WEBHOOK_SECRET = "test-webhook-secret";

/**
 * Why deposits reached the treasury and never appeared in the app.
 *
 * We computed the digest over `{timestamp}.{rawBody}` and REQUIRED a timestamp
 * header. The working Sweepflow integration signs the RAW BODY ALONE. So every
 * signature mismatched, the route answered 401, and nothing was recorded — no
 * settlement, no transaction, no trace. The money settled and the app never
 * knew the deposit existed.
 */

const body = JSON.stringify({ event: "deposit.completed", data: { requestId: "req_1" } });
const sign = (payload: string) =>
  crypto.createHmac("sha256", "test-webhook-secret").update(payload).digest("hex");

test("a body-only signature verifies — the scheme that was failing", () => {
  assert.equal(verifyDextopusSignature(null, body, sign(body)), true);
});

test("no timestamp header does not fail the check", () => {
  // The old code returned false outright when the header was absent.
  assert.equal(verifyDextopusSignature(null, body, sign(body)), true);
  assert.equal(verifyDextopusSignature("", body, sign(body)), true);
});

test("the timestamped variant still verifies", () => {
  // Kept so a provider that does prefix the timestamp isn't broken by the fix.
  const ts = String(Date.now());
  assert.equal(verifyDextopusSignature(ts, body, sign(`${ts}.${body}`)), true);
});

test("a sha256= prefix is tolerated", () => {
  assert.equal(verifyDextopusSignature(null, body, `sha256=${sign(body)}`), true);
});

test("a wrong signature is still rejected", () => {
  assert.equal(verifyDextopusSignature(null, body, sign("different body")), false);
  assert.equal(verifyDextopusSignature(null, body, "deadbeef"), false);
  assert.equal(verifyDextopusSignature(null, body, null), false);
});

test("a stale timestamp is rejected", () => {
  // Replay protection still applies when a timestamp IS supplied.
  const old = String(Date.now() - 10 * 60_000);
  assert.equal(verifyDextopusSignature(old, body, sign(body)), false);
});

test("a tampered body fails even with a valid-looking signature", () => {
  const sig = sign(body);
  assert.equal(verifyDextopusSignature(null, body + " ", sig), false);
});
