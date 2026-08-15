import { test } from "node:test";
import assert from "node:assert/strict";
import { canVerifyNetwork, verifyOnChain, verifyAcrossChains } from "../src/lib/settlement/onchain-verify";

/**
 * The guards on crediting from the chain.
 *
 * This path pays real money on the blockchain's word rather than the provider's,
 * so what matters is not that it credits — it is that it REFUSES, loudly, on
 * anything it cannot prove. Every case below is one where a "maybe" would
 * become a loss.
 */

test("only the chains we can actually read are verifiable", () => {
  assert.equal(canVerifyNetwork("sol"), true);
  assert.equal(canVerifyNetwork("erc20"), true);
  assert.equal(canVerifyNetwork("bep20"), true);
  assert.equal(canVerifyNetwork("base"), true);
  // Tron has no RPC wired up — it must not silently pass.
  assert.equal(canVerifyNetwork("trc20"), false);
  assert.equal(canVerifyNetwork("btc"), false);
  assert.equal(canVerifyNetwork(""), false);
});

test("an unknown network never verifies", async () => {
  const r = await verifyOnChain({ network: "dogecoin", txHash: "0xabc", address: "x" });
  assert.equal(r.verified, false);
  assert.match(r.reason ?? "", /no RPC/i);
});

test("a missing transaction hash never verifies", async () => {
  const r = await verifyOnChain({ network: "erc20", txHash: "", address: "0xabc" });
  assert.equal(r.verified, false);
  assert.match(r.reason ?? "", /no transaction hash/i);
});

test("a refusal always carries a reason", async () => {
  // Nothing may fail silently: a false with no reason is how a lost deposit
  // becomes invisible again.
  for (const net of ["trc20", "btc", "", "nonsense"]) {
    const r = await verifyOnChain({ network: net, txHash: "0x1", address: "a" });
    assert.equal(r.verified, false);
    assert.ok((r.reason ?? "").length > 0, `no reason given for "${net}"`);
  }
});

test("an EVM hash sent to a non-EVM address is refused without spending a call", async () => {
  const r = await verifyAcrossChains({
    txHash: "0x" + "a".repeat(64),
    address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  });
  assert.equal(r.verified, false);
  assert.match(r.reason ?? "", /isn't an EVM address/i);
});

test("verifying across chains still refuses with a reason and never throws", async () => {
  const r = await verifyAcrossChains({ txHash: "", address: "0x" + "b".repeat(40) });
  assert.equal(r.verified, false);
  assert.ok((r.reason ?? "").length > 0);
});
