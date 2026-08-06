import test from "node:test";
import assert from "node:assert/strict";
import { fillFromReply, draftGap, wantsToProceed, assembleFromHistory, type DraftState } from "../src/lib/assistant/draft-fill";
import { transferParts, parseBankName, parseAccountNumber } from "../src/lib/assistant/intent";
import { NIGERIAN_BANKS } from "../src/lib/banks";

/**
 * A transfer arrives a piece at a time, and every piece has to land.
 *
 * These walk real conversations rather than testing the parser twice: the bug
 * this replaces was never in a parser, it was in what the app did with what the
 * parser gave it — it asked a question and remembered nothing, so the answer
 * had nowhere to go and Ada asked again.
 */

const NAMES = NIGERIAN_BANKS.map((b) => b.name);
const fill = (d: DraftState, text: string) => fillFromReply(d, text, NAMES);

/** Apply what a message adds, the way the webhook does. */
function apply(d: DraftState, text: string): DraftState {
  const add = fill(d, text);
  return {
    ...d,
    bankName: add.bank ?? d.bankName,
    amount: add.amount ?? d.amount,
  };
}

test("the conversation that used to go in circles now finishes", () => {
  // Verbatim from a chat: a voice note, then the amount. It ended with Ada
  // saying "send it as one line so the parser picks it up".
  const first = "Send money to this account number 9136214038. Money point. Money point.";
  const parts = transferParts(first);
  assert.equal(parts?.account, "9136214038");

  let d: DraftState = {
    kind: "bank",
    amount: null,
    accountNumber: parts!.account!,
    bankName: parseBankName(first, NAMES) ?? null,
  };
  assert.match(d.bankName ?? "", /Moniepoint/);
  assert.equal(draftGap(d), "amount");

  d = apply(d, "I mean 1,500.");
  assert.equal(d.amount, 1500);
  assert.equal(draftGap(d), null, "should be ready to confirm");
});

test("the pieces can arrive in any order", () => {
  // Account first, bank second, amount third — one per message.
  let d: DraftState = { kind: "bank", amount: null, accountNumber: "9136214038", bankName: null };
  assert.equal(draftGap(d), "bank");

  d = apply(d, "Money points.");
  assert.match(d.bankName ?? "", /Moniepoint/);
  assert.equal(draftGap(d), "amount");

  d = apply(d, "1,500");
  assert.equal(d.amount, 1500);
  assert.equal(draftGap(d), null);
});

test("amount first, bank second works just as well", () => {
  let d: DraftState = { kind: "bank", amount: null, accountNumber: "9077984753", bankName: null };
  d = apply(d, "5k");
  assert.equal(d.amount, 5000);
  assert.equal(draftGap(d), "bank");

  d = apply(d, "opay");
  assert.match(d.bankName ?? "", /Opay/);
  assert.equal(draftGap(d), null);
});

test("one message carrying both is taken whole", () => {
  const d = apply({ kind: "bank", amount: null, accountNumber: "9077984753", bankName: null }, "gt bank, 2,500");
  assert.match(d.bankName ?? "", /Guaranty Trust/);
  assert.equal(d.amount, 2500);
  assert.equal(draftGap(d), null);
});

test("a question is not an answer", () => {
  // "What's 1000 naira in dollars" while a transfer is half-built must not
  // become a ₦1,000 transfer.
  const d: DraftState = { kind: "bank", amount: null, accountNumber: "9077984753", bankName: "Opay (Paycom)" };
  assert.deepEqual(fill(d, "what is 1000 naira in dollars"), {});
  assert.deepEqual(fill(d, "how much is your fee"), {});
  assert.deepEqual(fill(d, "why is my transfer pending"), {});
});

test("nothing is added by a message that adds nothing", () => {
  const d: DraftState = { kind: "bank", amount: null, accountNumber: "9077984753", bankName: "Opay (Paycom)" };
  assert.deepEqual(fill(d, "ok"), {});
  assert.deepEqual(fill(d, "thanks"), {});
  assert.deepEqual(fill(d, ""), {});
});

test("a piece already known is never overwritten", () => {
  // The amount is settled; a later mention of another number must not silently
  // change what is about to be sent.
  const d: DraftState = { kind: "bank", amount: 1500, accountNumber: "9077984753", bankName: "Opay (Paycom)" };
  assert.deepEqual(fill(d, "make it 9,000 instead"), {});
  assert.equal(draftGap(d), null);
});

test("a crypto draft never waits on a bank", () => {
  const d: DraftState = { kind: "crypto", amount: null, accountNumber: null, bankName: null, asset: "SOL", network: "Solana" };
  assert.equal(draftGap(d), "amount", "a chain has no bank to ask for");
  // A bank name in a crypto message means nothing and must not be recorded.
  assert.deepEqual(fill(d, "opay"), {});
  assert.equal(fill(d, "0.5").amount, 0.5);
});

test("an account number is not mistaken for an amount", () => {
  const d: DraftState = { kind: "bank", amount: null, accountNumber: "9136214038", bankName: "Opay (Paycom)" };
  assert.deepEqual(fill(d, "9136214038"), {});
});

test("a transfer can be rebuilt from the conversation when asked to go ahead", () => {
  // The real thread: the account, then the bank, then the amount — and then a
  // gap. Ada could see all three and say so, and still had no way to put a
  // confirmation in front of anyone.
  const turns = [
    { role: "user", text: "Send money to this account number 9136214038. Money point. Money point." },
    { role: "assistant", text: "Which bank is 9136214038?" },
    { role: "user", text: "Money points." },
    { role: "assistant", text: "Got it — 9136214038 at Moniepoint. How much should I send?" },
    { role: "user", text: "I mean 1,500." },
    { role: "assistant", text: "₦1,500 to Moniepoint, noted." },
  ];
  assert.ok(wantsToProceed("go ahead"));
  const built = assembleFromHistory(turns, NAMES, (t) => parseAccountNumber(t) ?? undefined);
  assert.equal(built.account, "9136214038");
  assert.match(built.bank ?? "", /Moniepoint/);
  assert.equal(built.amount, 1500);
});

test("a go-ahead is recognised the way people actually say it", () => {
  for (const yes of [
    "send it",
    "go ahead",
    "yes",
    "ok",
    "do it",
    "proceed",
    "confirm",
    "send now",
    // Being addressed by name is not a new instruction. "Do it for Ada" is
    // "Ada, do it" — she read it as a request to pay someone called Ada.
    "Yes do it",
    "Do it for Ada",
    "Ada do it",
    "Ada, do it",
    // Pidgin, which is how a lot of this app's users write.
    "abeg Ada send am",
    "send am",
    "do it jare",
    "make it go",
  ]) {
    assert.ok(wantsToProceed(yes), yes);
  }
});

test("only a message that IS the go-ahead rebuilds anything", () => {
  for (const no of [
    // The message that actually followed the dead conversation.
    "Busy?",
    "what are your fees",
    "how much is the fee",
    "hello",
    "why is it pending",
    "",
    "can you do it?",
    // Says who or how much: a fresh instruction for the parser, and it must
    // never quietly inherit a recipient from ten messages ago.
    "send money to my sister",
    "send 5k to 9077984753 Opay",
    "send to my brother account",
    "do it tomorrow when i get paid",
    "yes but change the bank first",
  ]) {
    assert.ok(!wantsToProceed(no), no);
  }
});

test("an amount is never taken from something Ada said", () => {
  // She quotes fees, balances and examples back. A number she wrote must never
  // become the number that leaves the account.
  const turns = [
    { role: "user", text: "send to 9136214038 Moniepoint" },
    { role: "assistant", text: "The fee would be ₦12, and your balance is ₦915." },
  ];
  const built = assembleFromHistory(turns, NAMES, (t) => parseAccountNumber(t) ?? undefined);
  assert.equal(built.account, "9136214038");
  assert.match(built.bank ?? "", /Moniepoint/);
  assert.equal(built.amount, undefined, "must not lift a figure out of her own message");
});

test("the newest amount wins over the one it replaced", () => {
  const turns = [
    { role: "user", text: "send 5,000 to 9136214038 Moniepoint" },
    { role: "assistant", text: "Got it." },
    { role: "user", text: "actually make it 1,500" },
  ];
  const built = assembleFromHistory(turns, NAMES, (t) => parseAccountNumber(t) ?? undefined);
  assert.equal(built.amount, 1500);
});

test("nothing is rebuilt from a conversation with no account in it", () => {
  const turns = [
    { role: "user", text: "what are your fees" },
    { role: "assistant", text: "Bank transfers cost ₦12 up to ₦5,000." },
  ];
  const built = assembleFromHistory(turns, NAMES, (t) => parseAccountNumber(t) ?? undefined);
  assert.equal(built.account, undefined);
});

test("a crypto draft waits on the asset before the amount", () => {
  // A QR carries an address, never what to send to it. That question used to be
  // asked with the address thrown away, so the answer landed on nothing.
  const d: DraftState = { kind: "crypto", amount: null, asset: null, network: "Solana" };
  assert.equal(draftGap(d), "asset");
  assert.equal(draftGap({ ...d, asset: "SOL" }), "amount");
  assert.equal(draftGap({ ...d, asset: "SOL", amount: 0.05 }), null);
});

test("a crypto draft waits on the chain before anything else", () => {
  // "Send 9.34 USDT to this Arbitruim Wallet 0x83c0…" came back as "Network:
  // Ethereum". One 0x address is valid on Ethereum, Arbitrum, Base, Polygon and
  // every other EVM rail, holding different money on each — so which chain is
  // the FIRST question, not an assumption, and it decides which assets are even
  // sendable there.
  const d: DraftState = { kind: "crypto", amount: 9.34, asset: "USDT", network: null };
  assert.equal(draftGap(d), "network");
  assert.equal(draftGap({ ...d, network: "Arbitrum" }), null);
});
