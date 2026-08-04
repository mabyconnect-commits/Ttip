import test from "node:test";
import assert from "node:assert/strict";
import { parseCryptoAddress, classify, shortAddress } from "../src/lib/assistant/crypto-address";

/**
 * Crypto is the one transfer with no recall, no provider to phone and no name
 * to check — a wrong address is simply gone. So the parser must be certain or
 * silent, and these are the cases that decide which.
 */

const EVM = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
const SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TRON = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const BTC_BECH32 = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const BTC_LEGACY = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";

test("each chain's address is recognised as its own", () => {
  assert.equal(parseCryptoAddress(EVM)?.family, "evm");
  assert.equal(parseCryptoAddress(SOL)?.family, "solana");
  assert.equal(parseCryptoAddress(TRON)?.family, "tron");
  assert.equal(parseCryptoAddress(BTC_BECH32)?.family, "bitcoin");
  assert.equal(parseCryptoAddress(BTC_LEGACY)?.family, "bitcoin");
});

test("Tron and legacy Bitcoin are not mistaken for Solana", () => {
  // Both are base58 of a length Solana also uses. Getting this wrong sends on
  // the wrong chain, which loses the money.
  assert.equal(parseCryptoAddress(TRON)?.family, "tron");
  assert.equal(parseCryptoAddress(BTC_LEGACY)?.family, "bitcoin");
});

test("an address inside a sentence is still found", () => {
  const r = parseCryptoAddress(`send it to ${EVM} please`);
  assert.equal(r?.address, EVM);
  assert.equal(r?.family, "evm");
});

test("the address is returned exactly, never reformatted", () => {
  // Mixed case in an EVM address is its checksum. Lowercasing it destroys the
  // one built-in defence against a typo.
  assert.equal(parseCryptoAddress(EVM)?.address, EVM);
  assert.equal(parseCryptoAddress(SOL)?.address, SOL);
});

test("a payment URI names its own chain, and its amount is read", () => {
  const r = parseCryptoAddress(`bitcoin:${BTC_BECH32}?amount=0.005&label=Shop`);
  assert.equal(r?.family, "bitcoin");
  assert.equal(r?.address, BTC_BECH32);
  assert.equal(r?.amount, 0.005);

  const eth = parseCryptoAddress(`ethereum:${EVM}`);
  assert.equal(eth?.family, "evm");
  assert.equal(eth?.address, EVM);
});

test("a URI that lies about its chain is refused, not guessed at", () => {
  // "bitcoin:" wrapping an EVM address is either a broken wallet or an attack.
  assert.equal(parseCryptoAddress(`bitcoin:${EVM}`), null);
  assert.equal(parseCryptoAddress(`solana:${TRON}`), null);
});

test("things that are not addresses return nothing", () => {
  for (const junk of [
    "",
    "hello",
    "send 5000 to 9077984753 Opay", // a NUBAN is not a wallet address
    "0x123", // too short
    "0xZZZZ35Cc6634C0532925a3b844Bc454e4438f44e", // not hex
    "https://ttip.site/u/matthew",
  ]) {
    assert.equal(parseCryptoAddress(junk), null, `matched: ${junk}`);
  }
});

test("a bank account number never reads as a Solana address", () => {
  // Ten digits. Solana is base58 and 32+ characters, so this must not match —
  // routing a naira transfer onto a chain would be unrecoverable.
  assert.equal(parseCryptoAddress("9077984753"), null);
  assert.equal(parseCryptoAddress("send 1200 to 9136214038"), null);
});

test("classify agrees with the parser on a bare address", () => {
  for (const [addr, family] of [
    [EVM, "evm"],
    [SOL, "solana"],
    [TRON, "tron"],
    [BTC_BECH32, "bitcoin"],
  ] as const) {
    assert.equal(classify(addr)?.family, family, addr);
  }
  assert.equal(classify("not an address"), null);
});

test("shortening keeps both ends, which are what people check", () => {
  const s = shortAddress(EVM);
  assert.ok(s.startsWith("0x742d35"), s);
  assert.ok(s.endsWith("438f44e"), s);
  assert.ok(s.length < EVM.length);
  // Short ones are left alone.
  assert.equal(shortAddress("0x1234"), "0x1234");
});
