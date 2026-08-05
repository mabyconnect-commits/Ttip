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

/* ------------------------------------------------------------------------
   Regression: a user sent 0.4 SOL and was credited 0.4 USDC.

   Two faults combined. The parser fell back from settlementAmountFormatted to
   originAmountFormatted independently of the asset, so a settlement symbol
   could carry an origin amount; and the webhook route then forced
   deposit.asset to the treasury symbol without touching deposit.amount.
   Either fault alone turns 0.4 SOL (~$60) into 0.4 USDC (~$0.40).
   ------------------------------------------------------------------------ */

test("parseDextopusDeposit keeps the origin and settlement pairs separate", () => {
  const d = parseDextopusDeposit({
    event: "deposit.completed",
    data: {
      userId: "user_sol",
      requestId: "req_sol_1",
      depositAddress: "SoLaNaAddr",
      originAsset: "SOL",
      originAmountFormatted: "0.4",
      originChainId: "solana",
      settlementAsset: "USDC",
      settlementAmountFormatted: "62.1408",
      settlementChainId: "solana",
      status: "COMPLETED",
    },
  });

  // Credit the settlement side — the real value received.
  assert.equal(d.asset, "USDC");
  assert.equal(d.amount, 62.1408);
  // Carry the origin side for display — never credited.
  assert.equal(d.originAsset, "SOL");
  assert.equal(d.originAmount, 0.4);
  // The bug itself: the credited amount must never be the origin amount.
  assert.notEqual(d.amount, 0.4);
});

test("parseDextopusDeposit refuses to pair a settlement asset with an origin amount", () => {
  // settlementAmountFormatted absent — the old code silently fell through to
  // originAmountFormatted and produced "0.4 USDC". It must now throw.
  assert.throws(
    () =>
      parseDextopusDeposit({
        event: "deposit.completed",
        data: {
          requestId: "req_sol_2",
          originAsset: "SOL",
          originAmountFormatted: "0.4",
          settlementAsset: "USDC",
          status: "COMPLETED",
        },
      }),
    /settlementAmountFormatted/,
  );
});

test("parseDextopusDeposit will not credit when settlement is missing entirely", () => {
  assert.throws(
    () =>
      parseDextopusDeposit({
        event: "deposit.completed",
        data: {
          requestId: "req_sol_3",
          originAsset: "SOL",
          originAmountFormatted: "0.4",
          status: "COMPLETED",
        },
      }),
    /settlementAsset/,
  );
});

test("parseDextopusDeposit handles a same-asset deposit with no conversion", () => {
  const d = parseDextopusDeposit({
    event: "deposit.completed",
    data: {
      requestId: "req_usdc",
      originAsset: "USDC",
      originAmountFormatted: "25",
      settlementAsset: "USDC",
      settlementAmountFormatted: "25",
      status: "COMPLETED",
    },
  });
  assert.equal(d.asset, "USDC");
  assert.equal(d.amount, 25);
  assert.equal(d.originAsset, "USDC");
  assert.equal(d.originAmount, 25);
});

test("parseDextopusDeposit ignores a malformed origin amount but still credits settlement", () => {
  const d = parseDextopusDeposit({
    event: "deposit.completed",
    data: {
      requestId: "req_odd",
      originAsset: "BTC",
      originAmountFormatted: "not-a-number",
      settlementAsset: "USDC",
      settlementAmountFormatted: "1500.5",
      status: "COMPLETED",
    },
  });
  assert.equal(d.amount, 1500.5);
  assert.equal(d.originAmount, undefined);
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

/* ------------------------------------------------------------------------
   Dextopus sends mint/contract ADDRESSES, not tickers.

   `originAsset` on a native SOL deposit is the System Program id
   `1111…1111`; USDC on Solana arrives as `EPjFWdd5…`. Comparing those
   against "USDC" reported mismatches that weren't real, and writing one
   into a balance would key it by a 44-char base58 string.
   ------------------------------------------------------------------------ */

test("resolveTokenSymbol maps native placeholders to their ticker", async () => {
  const { resolveTokenSymbol } = await import("../src/lib/settlement/dextopus");
  assert.equal(await resolveTokenSymbol("11111111111111111111111111111111"), "SOL");
  assert.equal(
    await resolveTokenSymbol("So11111111111111111111111111111111111111112"),
    "SOL",
  );
  assert.equal(
    await resolveTokenSymbol("0x0000000000000000000000000000000000000000"),
    "ETH",
  );
});

test("resolveTokenSymbol passes a ticker straight through", async () => {
  const { resolveTokenSymbol } = await import("../src/lib/settlement/dextopus");
  assert.equal(await resolveTokenSymbol("usdc"), "USDC");
  assert.equal(await resolveTokenSymbol("BTC"), "BTC");
});

test("resolveTokenSymbol returns undefined for an address it cannot resolve", async () => {
  const { resolveTokenSymbol } = await import("../src/lib/settlement/dextopus");
  // A well-formed EVM address that is in no catalog must not be mistaken for a
  // ticker — an unresolved address becoming a balance symbol is unrecoverable.
  const out = await resolveTokenSymbol("0x1234567890abcdef1234567890abcdef12345678");
  assert.equal(out, undefined);
});
