import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { toSubunit, verifyPaystackWebhook } from "../src/lib/settlement/webhook";

test("toSubunit converts a fiat amount to kobo/pesewas", () => {
  assert.equal(toSubunit(5000), 500000);
  assert.equal(toSubunit(1234.56), 123456);
  assert.equal(toSubunit(0.1), 10);
});

test("verifyPaystackWebhook accepts a correct HMAC-SHA512 and rejects tampering", () => {
  process.env.PAYSTACK_SECRET_KEY = "sk_test_abc";
  const body = JSON.stringify({ event: "transfer.success", data: { reference: "pyt_1", status: "success" } });
  const sig = crypto.createHmac("sha512", "sk_test_abc").update(body).digest("hex");
  assert.equal(verifyPaystackWebhook(body, sig), true);
  assert.equal(verifyPaystackWebhook(body + "x", sig), false);
  assert.equal(verifyPaystackWebhook(body, null), false);
});

test("verifyPaystackWebhook fails closed when no key is configured", () => {
  delete process.env.PAYSTACK_SECRET_KEY;
  assert.equal(verifyPaystackWebhook("{}", "deadbeef"), false);
});
