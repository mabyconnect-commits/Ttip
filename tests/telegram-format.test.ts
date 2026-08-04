import test from "node:test";
import assert from "node:assert/strict";
import { toTelegramHtml, toPlainText } from "../src/lib/telegram-format";

/**
 * Telegram renders no Markdown without a parse_mode, so Ada's `**Tier 2**`
 * arrived with the asterisks showing and the chat looked broken. These lock in
 * the conversion — and, more importantly, that nothing in the input can ever
 * become markup we didn't put there.
 */

test("bold, italic and code become Telegram HTML", () => {
  assert.equal(toTelegramHtml("**Tier 2 (Verified)**"), "<b>Tier 2 (Verified)</b>");
  assert.equal(toTelegramHtml("that is *really* important"), "that is <i>really</i> important");
  assert.equal(toTelegramHtml("set `PIN` first"), "set <code>PIN</code> first");
});

test("no asterisks survive into the output", () => {
  const out = toTelegramHtml("- **Holdings:** ₦202,564.42\n- **Cashback pot:** ₦341.66");
  assert.ok(!out.includes("*"), out);
  assert.ok(out.includes("<b>Holdings:</b>"), out);
});

test("dashes become real bullets", () => {
  assert.equal(toTelegramHtml("- one\n- two"), "• one\n• two");
  assert.equal(toTelegramHtml("* one\n+ two"), "• one\n• two");
});

test("headings become a bold line, since Telegram has none", () => {
  assert.equal(toTelegramHtml("## Your account"), "<b>Your account</b>");
});

test("the input is escaped before any tag is added", () => {
  // The critical property: a user (or the model) writing tag-shaped text must
  // never produce markup. If this fails, Telegram rejects the whole message.
  const out = toTelegramHtml('<script>alert("x")</script> & <b>me</b>');
  assert.ok(!out.includes("<script>"), out);
  assert.ok(out.includes("&lt;script&gt;"), out);
  assert.ok(out.includes("&amp;"), out);
});

test("only the tags we emit are ever real tags", () => {
  const out = toTelegramHtml("**bold** <i>not mine</i>");
  const tags = out.match(/<\/?[a-z]+>/g) ?? [];
  assert.deepEqual(tags, ["<b>", "</b>"]);
});

test("links render, and non-http schemes do not", () => {
  assert.equal(
    toTelegramHtml("[ttip](https://ttip.site)"),
    '<a href="https://ttip.site">ttip</a>',
  );
  const bad = toTelegramHtml("[x](javascript:alert(1))");
  assert.ok(!bad.includes("<a"), bad);
});

test("snake_case and multiplication are not turned into italics", () => {
  assert.equal(toTelegramHtml("field_name_here stays"), "field_name_here stays");
  assert.equal(toTelegramHtml("2 * 3 * 4"), "2 * 3 * 4");
});

test("the naira amounts people actually see come through untouched", () => {
  const out = toTelegramHtml("**Sending ₦5,000**\nTo: **ABIKE VICTORIA IBRAHIM**");
  assert.equal(out, "<b>Sending ₦5,000</b>\nTo: <b>ABIKE VICTORIA IBRAHIM</b>");
});

test("the plain-text fallback strips markdown rather than showing it", () => {
  const out = toPlainText("- **Holdings:** ₦202,564.42\n- *soon*");
  assert.equal(out, "• Holdings: ₦202,564.42\n• soon");
  assert.ok(!out.includes("*"), out);
});
