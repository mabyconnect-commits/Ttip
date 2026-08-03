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

// Flutterwave's real airtime/bill responses carry no status inside `data` — the
// only status is on the envelope. Reading `data.status` alone left every
// delivered bill stuck on "Pending" forever.
test("mapBillStatus completes a Flutterwave create response with no data.status", () => {
  assert.equal(
    mapBillStatus({
      status: "success",
      message: "Bill payment successful",
      data: {
        phone_number: "+2348113866493",
        amount: 500,
        network: "9MOBILE",
        flw_ref: "CF-FLYAPI-20200311081921359990",
        tx_ref: "BPUSSD1583957963415840",
        reference: null,
      },
    }),
    "completed",
  );
});

test("mapBillStatus completes a Flutterwave bill-status fetch with no data.status", () => {
  assert.equal(
    mapBillStatus({
      status: "success",
      message: "Bill status fetch successful",
      data: {
        currency: "NGN",
        customer_id: "2348109328188",
        frequency: "One Time",
        amount: "500.0000",
        product: "AIRTIME",
        product_name: "MTN",
        transaction_date: "2023-02-24T16:46:19.107Z",
        country: "NG",
        tx_ref: "CF-FLYAPI-20230224044619923826",
      },
    }),
    "completed",
  );
});

test("mapBillStatus keeps an explicit inner status over the envelope", () => {
  // A success envelope must never override the biller still processing.
  assert.equal(mapBillStatus({ status: "success", data: { status: "processing" } }), "pending");
  assert.equal(mapBillStatus({ status: "success", data: { status: "failed" } }), "failed");
});

test("mapBillStatus does not complete a success envelope with no payload", () => {
  assert.equal(mapBillStatus({ status: "success" }), "pending");
  assert.equal(mapBillStatus({ status: "success", data: null }), "pending");
  assert.equal(mapBillStatus({ status: "success", data: [] }), "pending");
});

test("mapBillStatus fails on an error envelope", () => {
  assert.equal(mapBillStatus({ status: "error", message: "Biller not enabled" }), "failed");
});
