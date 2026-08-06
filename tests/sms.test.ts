import test from "node:test";
import assert from "node:assert/strict";
import { parseSms, matchName } from "../src/lib/sms/parse";
import { withinCaps, smsMaxTransfer, smsDailyCap } from "../src/lib/sms/limits";
import { normalisePhone } from "../src/lib/sms/provider";

/**
 * Money by text message, on a phone with no data.
 *
 * SMS is the weakest surface in the app: no screen to check a name on, no
 * confirmation to read twice, nothing that can be deleted afterwards. So the
 * parser refuses anything it isn't sure of — an unrecognised message becomes
 * help, never an attempted transfer.
 */

test("the commands people will actually thumb in", () => {
  assert.deepEqual(parseSms("SEND 2000 MAMA"), { kind: "send", amount: 2000, to: "MAMA" });
  assert.deepEqual(parseSms("send 2k to mama"), { kind: "send", amount: 2000, to: "mama" });
  assert.deepEqual(parseSms("send 2,000 to my sister"), { kind: "send", amount: 2000, to: "sister" });
  assert.deepEqual(parseSms("pay 1.5k Kingsley"), { kind: "send", amount: 1500, to: "Kingsley" });
  assert.deepEqual(parseSms("bal"), { kind: "balance" });
  assert.deepEqual(parseSms("Balance?"), { kind: "balance" });
  assert.deepEqual(parseSms("LIST"), { kind: "list" });
  assert.deepEqual(parseSms("cancel"), { kind: "cancel" });
  assert.deepEqual(parseSms("help"), { kind: "help" });
});

test("half an instruction is never a transfer", () => {
  // An amount with nobody to send it to, or a name with no amount, is a
  // question — not a guess at the missing half.
  for (const t of ["send 2000", "send mama", "send", "send to mama please", "", "   "]) {
    assert.equal(parseSms(t).kind, "unknown", t);
  }
});

test("a bare number is a code, not an amount", () => {
  // Someone answering "reply with code #7" types six digits and nothing else.
  // Reading that as a transfer would be catastrophic.
  assert.deepEqual(parseSms("481920"), { kind: "code", code: "481920" });
  assert.deepEqual(parseSms(" 4819 "), { kind: "code", code: "4819" });
});

test("one match or nothing — never a guess between two people", () => {
  const saved = [
    { name: "Mama", handle: "Opay (Paycom)" },
    { name: "Mama Kemi", handle: "GTBank" },
    { name: "My Sister", handle: "Moniepoint" },
  ];
  // Exactly one exact match wins.
  assert.equal(matchName("mama", saved)?.handle, "Opay (Paycom)");
  // Whole words only: "sister" finds "My Sister"...
  assert.equal(matchName("sister", saved)?.name, "My Sister");
  // ...but a fragment matches nobody, rather than the nearest thing.
  assert.equal(matchName("mam", saved), null);
  assert.equal(matchName("kem", saved), null);
  assert.equal(matchName("", saved), null);
});

test("two candidates is a question, not a coin flip", () => {
  // Over SMS the user finds out it went to the wrong person after it has gone.
  const saved = [{ name: "Kola A" }, { name: "Kola B" }];
  assert.equal(matchName("kola", saved), null);
});

test("the caps are the smallest in the app, and they bite", () => {
  assert.equal(smsMaxTransfer(), 20_000);
  assert.equal(smsDailyCap(), 50_000);

  assert.equal(withinCaps(5_000, 0).ok, true);
  assert.equal(withinCaps(20_000, 0).ok, true);
  assert.equal(withinCaps(20_001, 0).ok, false);
  // The daily cap counts what has already gone.
  assert.equal(withinCaps(10_000, 45_000).ok, false);
  assert.equal(withinCaps(5_000, 45_000).ok, true);
  assert.equal(withinCaps(0, 0).ok, false);
  assert.equal(withinCaps(-100, 0).ok, false);
});

test("one SIM is one number, however the carrier writes it", () => {
  // The same phone arrives four ways depending on carrier and handset.
  // Treating them as four numbers is how a linked phone stops being recognised.
  for (const raw of ["08113866493", "2348113866493", "+234 811 386 6493", "8113866493"]) {
    assert.equal(normalisePhone(raw), "+2348113866493", raw);
  }
  assert.equal(normalisePhone("hello"), null);
  assert.equal(normalisePhone(""), null);
});
