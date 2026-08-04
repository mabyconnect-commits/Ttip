import test from "node:test";
import assert from "node:assert/strict";
import { spokenBank } from "../src/lib/assistant/bank-spoken";
import { parseBankName } from "../src/lib/assistant/intent";
import { NIGERIAN_BANKS } from "../src/lib/banks";

/**
 * The bank has to be recognised from how it was SAID, not how it is registered.
 * When it isn't, Ada asks a question the user already answered — which is what
 * turned a one-sentence transfer into five and made her look like she wasn't
 * listening.
 */

const NAMES = NIGERIAN_BANKS.map((b) => b.name);

test("a transcribed voice note still names the bank", () => {
  // Verbatim from a real chat: this is what a transcriber makes of "Moniepoint".
  assert.match(
    parseBankName("Send money to this account number 9136214038. Money point. Money point.", NAMES) ?? "",
    /Moniepoint/,
  );
  assert.match(parseBankName("Money points.", NAMES) ?? "", /Moniepoint/);
  assert.match(parseBankName("Monie point", NAMES) ?? "", /Moniepoint/);
});

test("the fintechs people actually use are recognised however they're written", () => {
  for (const [said, expected] of [
    ["opay", /Opay/],
    ["O pay", /Opay/],
    ["send it to my o-pay", /Opay/],
    ["palm pay", /Palmpay/],
    ["palmpay", /Palmpay/],
    ["kuda", /Kuda/],
    ["fair money", /Fairmoney/],
    ["moniepoint mfb", /Moniepoint/],
  ] as [string, RegExp][]) {
    assert.match(parseBankName(said, NAMES) ?? "", expected, said);
  }
});

test("the big banks answer to their street names", () => {
  for (const [said, expected] of [
    ["gt bank", /Guaranty Trust/],
    ["GTB", /Guaranty Trust/],
    ["first bank", /First Bank of Nigeria/],
    ["UBA", /United Bank For Africa/],
    ["fcmb", /First City Monument/],
    ["zenith", /Zenith/],
    ["access bank", /Access Bank/],
    ["stanbic", /Stanbic/],
    ["eco bank", /Ecobank/],
    ["wema", /Wema/],
  ] as [string, RegExp][]) {
    assert.match(parseBankName(said, NAMES) ?? "", expected, said);
  }
});

test("a message with no bank in it names none", () => {
  // The cost of a wrong guess is money sent to the wrong institution, so
  // silence has to be the answer whenever we aren't sure.
  for (const junk of [
    "",
    "how much are your fees",
    "send 5000",
    "1,500",
    "why is my transfer pending",
    "9136214038",
  ]) {
    assert.equal(spokenBank(junk, NAMES), undefined, junk);
  }
});

test("the answer is always a bank from the list, never an invented name", () => {
  for (const said of ["money point", "gt bank", "o pay", "first bank"]) {
    const hit = parseBankName(said, NAMES);
    assert.ok(hit && NAMES.includes(hit), `${said} → ${hit}`);
  }
});
