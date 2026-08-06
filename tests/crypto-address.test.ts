import test from "node:test";
import assert from "node:assert/strict";
import { parseCryptoAddress, classify, shortAddress, parseCryptoAsset, mentionsCrypto, parseEvmChain, networkFor, EVM_CHAINS, EVM_CHAIN_LABELS } from "../src/lib/assistant/crypto-address";
import { chainIdForNetwork } from "../src/lib/chains";

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

test("an asset is recognised by name, not just by ticker", () => {
  // A voice note says "Solana", never "SOL". Missing that sent "0.05 Solana"
  // into the naira parser, which offered a ₦0.05 BANK transfer.
  assert.equal(parseCryptoAsset("Send the 0.05 Solana to the address I pasted"), "SOL");
  assert.equal(parseCryptoAsset("0.05 SOL"), "SOL");
  assert.equal(parseCryptoAsset("send 20 usdt"), "USDT");
  assert.equal(parseCryptoAsset("send 20 tether"), "USDT");
  assert.equal(parseCryptoAsset("0.001 bitcoin"), "BTC");
  assert.equal(parseCryptoAsset("some ethereum"), "ETH");
});

test("an asset is only offered when it can be sent on that chain", () => {
  // Naming something they can't send there has to stay a question, not become
  // a guess that puts the money on the wrong chain.
  assert.equal(parseCryptoAsset("send 0.05 solana", ["USDC", "USDT"]), undefined);
  assert.equal(parseCryptoAsset("send some usdc", ["USDC", "USDT"]), "USDC");
});

test("an ordinary naira message names no crypto at all", () => {
  for (const t of ["send 5000 to 9077984753 Opay", "what are your fees", "1,500", ""]) {
    assert.equal(mentionsCrypto(t), false, t);
  }
  assert.equal(mentionsCrypto("send 0.05 solana"), true);
});

test("an asset survives being mis-transcribed", () => {
  // Verbatim from a chat: "Okay, send SOL" came back from the transcriber as
  // "Okay. Send soul." The word was right there and the app couldn't see it.
  assert.equal(parseCryptoAsset("Okay. Send soul."), "SOL");
  assert.equal(parseCryptoAsset("send sole"), "SOL");
  assert.equal(parseCryptoAsset("salana"), "SOL");
  assert.equal(parseCryptoAsset("send u s d t"), "USDT");
  assert.equal(parseCryptoAsset("send bit coin"), "BTC");
  assert.equal(parseCryptoAsset("etherium"), "ETH");
});

test("a word that merely contains a ticker is not an asset", () => {
  // "JENMEC SOLUTIONS LTD" is a beneficiary name, not an instruction to send
  // SOL — matching inside words would turn one into the other.
  for (const t of [
    "JENMEC SOLUTIONS LTD - MATTHEW OLUWATOBI ADELEYE",
    "i need a solution",
    "soldier",
    "console the user",
    "send 5000 to 9077984753 Opay",
  ]) {
    assert.equal(parseCryptoAsset(t), undefined, t);
  }
});

/**
 * Which EVM chain.
 *
 * Verbatim from a chat: "Hey Ada Please Send 9.34 Usdt to this Arbitruim
 * Wallet 0x83c0…" — confirmed back as "Network: Ethereum". One 0x address is
 * valid on Ethereum, Arbitrum, Base, Polygon and every other EVM rail, and they
 * hold different money, so reading one shape as one chain sends real funds onto
 * a rail nobody is watching.
 */
test("the chain the user named wins", () => {
  assert.equal(parseEvmChain("Send 9.34 Usdt to this Arbitruim Wallet"), "Arbitrum");
  assert.equal(parseEvmChain("send it on arbitrum"), "Arbitrum");
  assert.equal(parseEvmChain("this is a Base wallet"), "Base");
  assert.equal(parseEvmChain("on polygon please"), "Polygon");
  assert.equal(parseEvmChain("matic network"), "Polygon");
  assert.equal(parseEvmChain("bnb chain"), "BNB Chain");
  assert.equal(parseEvmChain("bep20"), "BNB Chain");
  assert.equal(parseEvmChain("binance smart chain"), "BNB Chain");
  assert.equal(parseEvmChain("optimism"), "Optimism");
  assert.equal(parseEvmChain("avalanche"), "Avalanche");
  assert.equal(parseEvmChain("erc-20"), "Ethereum");
  assert.equal(parseEvmChain("on ethereum"), "Ethereum");
});

test("a named chain beats an asset that sounds like one", () => {
  // "Send ETH to this Base wallet" names the asset ETH and the chain Base. The
  // chain the user actually said has to win, or their money lands on Ethereum.
  assert.equal(parseEvmChain("Send 0.2 ETH to this Base wallet"), "Base");
  assert.equal(parseEvmChain("send eth on arbitrum"), "Arbitrum");
});

test("a bare ticker names no chain at all", () => {
  // ETH is the asset. Someone sending ETH to an Arbitrum wallet says so, and
  // treating the ticker as the chain is exactly the guess that lost the money.
  for (const t of ["send 0.2 ETH", "send 9.34 USDT to this wallet", "0.5 usdc", ""]) {
    assert.equal(parseEvmChain(t), undefined, t);
  }
});

test("an EVM address without a named chain is a question, not a default", () => {
  assert.equal(networkFor("evm", "send 9.34 USDT to this wallet"), undefined);
  assert.equal(networkFor("evm", "send 9.34 USDT to this Arbitrum wallet"), "Arbitrum");
  // The single-chain families are never ambiguous.
  assert.equal(networkFor("solana", "send 0.05"), "Solana");
  assert.equal(networkFor("tron", "send 5 usdt"), "Tron");
  assert.equal(networkFor("bitcoin", "send 0.001"), "Bitcoin");
});

test("every chain we offer is one the send route can resolve", () => {
  // A label we display but can't turn into a chain id is a send refused at the
  // last step on a chain we already promised the user.
  for (const label of EVM_CHAIN_LABELS) {
    assert.ok(chainIdForNetwork(label), `${label} has no chain id`);
  }
  for (const { label } of EVM_CHAINS) {
    assert.ok(chainIdForNetwork(label), `${label} has no chain id`);
  }
});
