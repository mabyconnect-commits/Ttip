import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatFiat,
  formatFiatCompact,
  formatCrypto,
  formatUsd,
  dayStr,
  isYesterday,
} from "../src/lib/format";

test("formatFiat renders the naira symbol and grouping", () => {
  assert.equal(formatFiat(4268540.22, "NGN"), "₦4,268,540.22");
});

test("formatFiat spaces the shilling symbol", () => {
  assert.match(formatFiat(1000, "KES"), /^KSh /);
});

test("formatFiatCompact abbreviates large amounts", () => {
  assert.equal(formatFiatCompact(168_400_000, "NGN"), "₦168.4M");
  assert.equal(formatFiatCompact(2_500, "NGN"), "₦2.5K");
  assert.equal(formatFiatCompact(3_100_000_000, "NGN"), "₦3.1B");
});

test("formatCrypto trims trailing precision and handles zero", () => {
  assert.equal(formatCrypto(0, "BTC"), "0");
  assert.equal(formatCrypto(0.01820000, "BTC"), "0.0182");
});

test("formatUsd always shows two decimals", () => {
  assert.equal(formatUsd(1234.5), "$1,234.50");
});

test("dayStr returns a UTC YYYY-MM-DD", () => {
  assert.equal(dayStr(new Date("2026-08-01T23:30:00Z")), "2026-08-01");
});

test("isYesterday compares calendar days in UTC", () => {
  const ref = new Date("2026-08-01T10:00:00Z");
  assert.equal(isYesterday("2026-07-31", ref), true);
  assert.equal(isYesterday("2026-08-01", ref), false);
});
