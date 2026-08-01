import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import {
  parseDeposit,
  verifyDepositSignature,
  parseDextopusDeposit,
  verifyDextopusSignature,
} from "../src/lib/settlement/webhook";

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

test("parseDextopusDeposit credits the settlement asset and echoes userId", () => {
  const body = {
    event: "deposit.completed",
    data: {
      userId: "user_123",
      requestId: "req_abc",
      depositAddress: "0xdeadbeef",
      settlementAsset: "usdt",
      settlementAmountFormatted: "49.88",
      settlementChainId: 728126428,
      status: "COMPLETED",
    },
  };
  const d = parseDextopusDeposit(body);
  assert.equal(d.externalId, "req_abc");
  assert.equal(d.asset, "USDT");
  assert.equal(d.amount, 49.88);
  assert.equal(d.userId, "user_123");
  assert.equal(d.status, "confirmed");
});

test("parseDextopusDeposit marks a non-completed event pending", () => {
  const d = parseDextopusDeposit({ event: "deposit.created", data: { requestId: "r", settlementAsset: "USDT", settlementAmountFormatted: "1", status: "PENDING" } });
  assert.equal(d.status, "pending");
});

test("verifyDextopusSignature enforces the timestamp.body HMAC scheme", () => {
  process.env.DEXTOPUS_WEBHOOK_SECRET = "whsec_1";
  const body = JSON.stringify({ event: "deposit.completed", data: { requestId: "r" } });
  const ts = String(Date.now());
  const sig = crypto.createHmac("sha256", "whsec_1").update(`${ts}.${body}`).digest("hex");
  assert.equal(verifyDextopusSignature(ts, body, sig), true);
  assert.equal(verifyDextopusSignature(ts, body + "x", sig), false); // body changed
  assert.equal(verifyDextopusSignature(String(Date.now() - 10 * 60_000), body, sig), false); // stale
  assert.equal(verifyDextopusSignature(null, body, sig), false); // missing timestamp
});
