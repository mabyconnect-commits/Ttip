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

test("parseDextopusDeposit credits the settlement pair and flags it settled", () => {
  const d = parseDextopusDeposit({
    event: "deposit.completed",
    data: { requestId: "r1", originAsset: "SOL", originAmountFormatted: "1.3", settlementAsset: "USDC", settlementAmountFormatted: "275.4", status: "COMPLETED" },
  });
  assert.equal(d.asset, "USDC");
  assert.equal(d.amount, 275.4);
  assert.equal(d.settled, true);
});

test("parseDextopusDeposit never credits the origin amount as the settlement asset (1.3 SOL is not 1.3 USDC)", () => {
  // Only origin fields present — no settlement amount. It must stay the origin
  // pair (SOL 1.3045), not become "1.3045 USDC" once the route relabels.
  const d = parseDextopusDeposit({
    event: "deposit.completed",
    data: { requestId: "r2", originAsset: "SOL", originAmountFormatted: "1.3045", status: "COMPLETED" },
  });
  assert.equal(d.asset, "SOL");
  assert.equal(d.amount, 1.3045);
  assert.equal(d.settled, false);
});

test("parseDextopusDeposit reads the settlement amount under alternate field names", () => {
  const d = parseDextopusDeposit({
    event: "deposit.completed",
    data: { requestId: "r3", originAsset: "SOL", originAmount: "1.3", destinationAsset: "USDC", amountOut: "274.9", status: "COMPLETED" },
  });
  assert.equal(d.asset, "USDC");
  assert.equal(d.amount, 274.9);
  assert.equal(d.settled, true);
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
