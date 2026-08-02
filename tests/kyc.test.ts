import { test } from "node:test";
import assert from "node:assert/strict";
import { nameMatches } from "../src/lib/kyc/types";

test("nameMatches accepts an exact first+last match", () => {
  assert.equal(nameMatches("Chidi Okeke", { firstName: "Chidi", lastName: "Okeke" }), true);
});

test("nameMatches is order-independent and ignores a missing middle name", () => {
  assert.equal(nameMatches("Okeke Chidi Emeka", { firstName: "Chidi", lastName: "Okeke", middleName: "Emeka" }), true);
});

test("nameMatches is case- and accent-insensitive", () => {
  assert.equal(nameMatches("chidi OKEKE", { firstName: "Chídi", lastName: "Okeke" }), true);
});

test("nameMatches rejects when the surname is different (someone else's BVN)", () => {
  assert.equal(nameMatches("Chidi Adeyemi", { firstName: "Chidi", lastName: "Okeke" }), false);
});

test("nameMatches rejects when only the first name matches", () => {
  assert.equal(nameMatches("Chidi", { firstName: "Chidi", lastName: "Okeke" }), false);
});

test("nameMatches needs both first and last on the record", () => {
  assert.equal(nameMatches("Chidi Okeke", { firstName: "Chidi" }), false);
});
