import { test } from "node:test";
import assert from "node:assert/strict";
import { mapBillStatus } from "../src/lib/settlement/bill-status";

test("mapBillStatus reads a terminal status from data.status", () => {
  assert.equal(mapBillStatus({ data: { status: "successful" } }), "completed");
  assert.equal(mapBillStatus({ data: { status: "COMPLETED" } }), "completed");
  assert.equal(mapBillStatus({ data: { status: "failed" } }), "failed");
  assert.equal(mapBillStatus({ data: { status: "reversed" } }), "failed");
});

test("mapBillStatus reads a status from an array-shaped data", () => {
  assert.equal(mapBillStatus({ data: [{ status: "delivered" }] }), "completed");
  assert.equal(mapBillStatus({ data: [{ status: "error" }] }), "failed");
});

test("mapBillStatus defaults to pending for processing/unknown/missing", () => {
  assert.equal(mapBillStatus({ data: { status: "processing" } }), "pending");
  assert.equal(mapBillStatus({ data: {} }), "pending");
  assert.equal(mapBillStatus({}), "pending");
  assert.equal(mapBillStatus(null), "pending");
});
