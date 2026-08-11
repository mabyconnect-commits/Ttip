import { test } from "node:test";
import assert from "node:assert/strict";
import { isListedAsset, resolveDepositAsset, implausibleDeposit } from "../src/lib/settlement/asset-resolve";

/**
 * The regression this file exists for:
 *
 * A real USDT deposit settled into treasury and never reached the user's
 * balance. The asset guard asked "is this a listed ticker?" of a string that
 * was the token's CONTRACT ADDRESS — which is what our own settlement config
 * sends and what the provider echoes back — got "no", and held the deposit in a
 * status nothing in the app reads. The money existed on-chain and nowhere else.
 *
 * Resolving the name before refusing to credit is the fix, so these cases are
 * pinned.
 */

test("plain tickers are recognized, junk is not", () => {
  assert.equal(isListedAsset("USDT"), true);
  assert.equal(isListedAsset("usdt"), true);
  assert.equal(isListedAsset("NGN"), true);
  assert.equal(isListedAsset("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"), false);
  assert.equal(isListedAsset(""), false);
});

test("a ticker resolves to itself, in our own casing", async () => {
  assert.equal(await resolveDepositAsset("USDT"), "USDT");
  // Lowercase must NOT become its own wallet row — "usdt" and "USDT" being two
  // balances is how a deposit lands somewhere the user can't see or spend.
  assert.equal(await resolveDepositAsset("usdt"), "USDT");
  assert.equal(await resolveDepositAsset(" Usdc "), "USDC");
});

test("a ticker with the network glued on still resolves", async () => {
  // Providers name the same asset a dozen ways; only the ticker part counts,
  // and it still has to be one we list.
  assert.equal(await resolveDepositAsset("USDT_TRON"), "USDT");
  assert.equal(await resolveDepositAsset("USDT.TRC20"), "USDT");
  assert.equal(await resolveDepositAsset("USDC.e"), "USDC");
  assert.equal(await resolveDepositAsset("USDT-BEP20"), "USDT");
});

test("an unidentifiable asset resolves to null, never to a guess", async () => {
  // Held for review is the right ending here. Inventing a ticker would credit
  // someone real balance for a token we can't price or sell.
  assert.equal(await resolveDepositAsset(""), null);
  assert.equal(await resolveDepositAsset("SOMERANDOMTOKEN"), null);
  // An address we can't find in the catalogue must not be credited either.
  assert.equal(await resolveDepositAsset("0x1111111111111111111111111111111111111111"), null);
});

test("our settlement contracts resolve with no network call", async () => {
  // The exact shape that broke, and the reason it must not depend on the
  // provider catalogue being reachable: these are the addresses our own
  // settlement config sends, so they resolve offline.
  assert.equal(await resolveDepositAsset("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"), "USDC"); // Ethereum
  assert.equal(await resolveDepositAsset("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), "USDC"); // Solana
  assert.equal(await resolveDepositAsset("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"), "USDT"); // Tron
  assert.equal(await resolveDepositAsset("0xdAC17F958D2ee523a2206206994597C13D831ec7"), "USDT"); // Ethereum, mixed case
  // And a contract must never come back as its own "ticker".
  const v = await resolveDepositAsset("0x1111111111111111111111111111111111111111");
  assert.equal(v, null);
});

test("a chain's own coin, sent as a placeholder address, resolves", async () => {
  // Native SOL arrives as the Solana System Program id. Seen in real Dextopus
  // data — without this it matches no token in any catalogue and is held for
  // ever.
  assert.equal(await resolveDepositAsset("11111111111111111111111111111111"), "SOL");
  assert.equal(await resolveDepositAsset("So11111111111111111111111111111111111111112"), "SOL");
});

test("an EVM native placeholder is only resolved when we know the chain", async () => {
  // 0x000…0 is ETH on Ethereum, BNB on BNB Chain, POL on Polygon. Crediting the
  // wrong coin is worse than holding, so no chain means no answer.
  assert.equal(await resolveDepositAsset("0x0000000000000000000000000000000000000000"), null);
  assert.equal(await resolveDepositAsset("0x0000000000000000000000000000000000000000", 1), "ETH");
  assert.equal(await resolveDepositAsset("0x0000000000000000000000000000000000000000", 56), "BNB");
  assert.equal(await resolveDepositAsset("0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", 137), "MATIC");
  // A chain we don't have a native coin for stays held rather than guessing.
  assert.equal(await resolveDepositAsset("0x0000000000000000000000000000000000000000", 99999), null);
});

test("addresses resolve even after a webhook has shouted them", async () => {
  // THE LIVE BUG. parseDextopusDeposit uppercased the asset and the webhook
  // route uppercased DEXTOPUS_SETTLEMENT_ASSET on top, so what reached the
  // guard was "0XA0B8…" — which the EVM pattern rejects, because it demands a
  // lowercase "0x". The Tron address fared worse: uppercasing introduced an
  // "O", a character base58 does not use, so it failed too. Both were held.
  //
  // Both upstream uppercases are gone now, but rows already written that way
  // are still in the database and must resolve, so this stays pinned.
  assert.equal(await resolveDepositAsset("0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48"), "USDC");
  assert.equal(await resolveDepositAsset("TR7NHQJEKQXGTCI8Q8ZY4PL8OTSZGJLJ6T"), "USDT");
  assert.equal(await resolveDepositAsset("EPJFWDD5AUFQSSQEM2QN1XZYBAPC8G4WEGGKZWYTDT1V"), "USDC");
  assert.equal(await resolveDepositAsset("0XDAC17F958D2EE523A2206206994597C13D831EC7"), "USDT");
});

test("a shouted ticker is still just a ticker", async () => {
  // The loosened address test must not start swallowing ordinary symbols.
  assert.equal(await resolveDepositAsset("USDT"), "USDT");
  assert.equal(await resolveDepositAsset("BTC"), "BTC");
  assert.equal(await resolveDepositAsset("NGN"), "NGN");
});

test("a raw-base-units amount is never creditable", async () => {
  // What actually happened: 10.29 USDT on an 18-decimal token arrived as
  // 10290000000000000000 and was credited verbatim. Ten quintillion USDT in a
  // wallet, spendable.
  assert.equal(implausibleDeposit("USDT", 1.029e19), true);
  assert.equal(implausibleDeposit("USDC", 986415000000000000), true);
  // Real deposits are unaffected.
  assert.equal(implausibleDeposit("USDT", 10.29), false);
  assert.equal(implausibleDeposit("USDC", 0.986415), false);
  assert.equal(implausibleDeposit("BTC", 0.01), false);
  // Nonsense is never creditable either.
  assert.equal(implausibleDeposit("USDT", 0), true);
  assert.equal(implausibleDeposit("USDT", Number.NaN), true);
  assert.equal(implausibleDeposit("USDT", -5), true);
});

test("fiat is exempt from the unit ceiling", () => {
  // A million naira is an ordinary sum, not a raw-units bug.
  assert.equal(implausibleDeposit("NGN", 5_000_000), false);
});
