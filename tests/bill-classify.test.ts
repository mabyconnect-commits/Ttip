import { test } from "node:test";
import assert from "node:assert/strict";
import { categoryOf, providerOf, buildCatalog, type RawBillItem } from "../src/lib/settlement/bill-classify";

test("categoryOf classifies by is_airtime, label and name", () => {
  assert.equal(categoryOf({ is_airtime: true, biller_name: "AIRTIME" }), "airtime");
  assert.equal(categoryOf({ label_name: "Meter Number", biller_name: "EKEDC PREPAID" }), "electricity");
  assert.equal(categoryOf({ label_name: "Smartcard Number", biller_name: "DStv Compact" }), "tv");
  assert.equal(categoryOf({ label_name: "Phone Number", name: "MTN 1.5GB Monthly", biller_name: "MTN Data" }), "data");
  assert.equal(categoryOf({ label_name: "Account Number", name: "Smile 15GB Data Bundle", biller_name: "Smile" }), "internet");
  assert.equal(categoryOf({ label_name: "Number", biller_name: "Catholic Archdiocese of Lagos" }), null);
});

test("providerOf returns curated provider names only", () => {
  assert.equal(providerOf("data", { biller_name: "MTN 1.5GB" }), "MTN");
  assert.equal(providerOf("tv", { biller_name: "DStv Compact" }), "DStv");
  assert.equal(providerOf("electricity", { biller_name: "IKEDC PREPAID TOPUP" }), "Ikeja (IKEDC)");
  assert.equal(providerOf("data", { biller_name: "Random Biller" }), null);
});

test("buildCatalog groups, dedupes and sorts", () => {
  const raw: RawBillItem[] = [
    { is_airtime: true, biller_code: "BIL099", item_code: "AT099", name: "MTN VTU", biller_name: "AIRTIME MTN", amount: 0, label_name: "Phone Number" },
    { biller_code: "BIL121", item_code: "CB178", name: "DSTV Compact + HD", biller_name: "DSTV COMPACT + HD", amount: 20700, label_name: "Smartcard Number" },
    { biller_code: "BIL121", item_code: "CB177", name: "DSTV Compact", biller_name: "DSTV COMPACT", amount: 19000, label_name: "Smartcard Number" },
    { biller_code: "BIL121", item_code: "CB177", name: "DSTV Compact", biller_name: "DSTV COMPACT", amount: 19000, label_name: "Smartcard Number" }, // dup
    { biller_code: "BIL112", item_code: "UB157", name: "EKEDC PREPAID", biller_name: "EKEDC PREPAID TOPUP", amount: 0, label_name: "Meter Number" },
    { biller_code: "BILXXX", item_code: "RIYYY", name: "Tithe", biller_name: "Winners Chapel", amount: 0, label_name: "Number" }, // skipped
  ];
  const cat = buildCatalog(raw);

  assert.ok(cat.airtime && cat.tv && cat.electricity);
  assert.equal(cat.airtime.providers[0].provider, "MTN");
  assert.equal(cat.airtime.providers[0].items[0].variableAmount, true);

  // TV: deduped to 2 items, sorted by price ascending.
  const dstv = cat.tv.providers.find((p) => p.provider === "DStv")!;
  assert.equal(dstv.items.length, 2);
  assert.equal(dstv.items[0].amount, 19000);
  assert.equal(dstv.items[1].amount, 20700);

  // Church/school billers are dropped entirely.
  assert.equal(Object.values(cat).some((c) => c.providers.some((p) => /chapel/i.test(p.provider))), false);
});
