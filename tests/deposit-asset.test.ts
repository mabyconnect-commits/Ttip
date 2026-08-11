import { test } from "node:test";
import assert from "node:assert/strict";
import { isListedAsset, resolveDepositAsset } from "../src/lib/settlement/asset-resolve";

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
