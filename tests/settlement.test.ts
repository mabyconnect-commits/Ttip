import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { parseDeposit, verifyDepositSignature } from "../src/lib/settlement/webhook";

process.env.DEPOSIT_WEBHOOK_SECRET = "test-secret";

test("parseDeposit normalizes a valid payload", () => {
  const d = parseDeposit({ id: "0xabc", address: "TXYZ", currency: "usdt", network: "TRON", amount: 25 });
  assert.equal(d.externalId, "0xabc");
  assert.equal(d.asset, "USDT");
  assert.equal(d.chain, "tron");
  assert.equal(d.amount, 25);
  assert.equal(d.status, "confirmed");
});

test("parseDeposit rejects payloads missing required fields", () => {
  assert.throws(() => parseDeposit({ address: "T", asset: "USDT" })); // no id, no amount
  assert.throws(() => parseDeposit({ id: "x", address: "T", asset: "USDT", amount: 0 })); // non-positive
});

test("parseDeposit honours an explicit pending status", () => {
  const d = parseDeposit({ id: "x", address: "T", asset: "USDT", amount: 1, status: "pending" });
  assert.equal(d.status, "pending");
});

test("verifyDepositSignature accepts a correct HMAC and rejects tampering", () => {
  const body = JSON.stringify({ id: "x", address: "T", asset: "USDT", amount: 5 });
  const sig = crypto.createHmac("sha256", "test-secret").update(body).digest("hex");
  assert.equal(verifyDepositSignature(body, sig), true);
  assert.equal(verifyDepositSignature(body + " ", sig), false); // body changed
  assert.equal(verifyDepositSignature(body, sig.slice(0, -2) + "00"), false); // sig changed
  assert.equal(verifyDepositSignature(body, null), false); // missing sig
});
