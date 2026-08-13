import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDepositAsset, isListedAsset, couldBeAddress } from "../src/lib/settlement/asset-resolve";

/**
 * THE deposit bug, pinned with the exact string from a production trace.
 *
 *   0.15  EPJFWDD5AUFQSSQEM2QN1XZYBAPC8G4WEGGKZWYTDT1V
 *   HELD — refused by the asset guard, never credited
 *
 * That is the Solana USDC mint, upper-cased by our own parser. Dextopus sends
 * the settlement asset as a MINT ADDRESS; the guard asked whether it was a
 * listed ticker, got no, and held the deposit. The money reached treasury and
 * the user's balance never moved.
 */

test("the exact held string resolves to USDC", async () => {
  // The full 44-character mint, upper-cased — exactly what the trace showed
  // once the wrapped line is read to its end.
  assert.equal(await resolveDepositAsset("EPJFWDD5AUFQSSQEM2QN1XZYBAPC8G4WEGGKZWYTDT1V"), "USDC");
});

test("the mint resolves in its real casing too", async () => {
  assert.equal(await resolveDepositAsset("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), "USDC");
});

test("the other settlement mints resolve, shouted or not", async () => {
  assert.equal(await resolveDepositAsset("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"), "USDT"); // Tron
  assert.equal(await resolveDepositAsset("TR7NHQJEKQXGTCI8Q8ZY4PL8OTSZGJLJ6T"), "USDT");
  assert.equal(await resolveDepositAsset("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"), "USDC"); // Ethereum
  assert.equal(await resolveDepositAsset("0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48"), "USDC");
});

test("a chain's own coin sent as a placeholder resolves", async () => {
  assert.equal(await resolveDepositAsset("11111111111111111111111111111111"), "SOL");
  // EVM placeholders are ambiguous without the chain, so they stay held.
  assert.equal(await resolveDepositAsset("0x0000000000000000000000000000000000000000"), null);
  assert.equal(await resolveDepositAsset("0x0000000000000000000000000000000000000000", 56), "BNB");
});

test("plain tickers still work and unknowns are still refused", async () => {
  assert.equal(await resolveDepositAsset("USDT"), "USDT");
  assert.equal(await resolveDepositAsset("usdc"), "USDC");
  assert.equal(await resolveDepositAsset("SOMERANDOMTOKEN"), null);
  assert.equal(await resolveDepositAsset(""), null);
  assert.equal(isListedAsset("NGN"), true);
});

test("an address is never mistaken for a ticker", () => {
  assert.equal(couldBeAddress("EPJFWDD5AUFQSSQEM2QN1XZYBAPC8G4WEGGKZWYTDT1V"), true);
  assert.equal(couldBeAddress("USDC"), false);
  assert.equal(couldBeAddress("BTC"), false);
});
