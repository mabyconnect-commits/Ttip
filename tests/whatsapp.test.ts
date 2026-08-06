import test from "node:test";
import assert from "node:assert/strict";
import { toWhatsAppMarkup } from "../src/lib/whatsapp";

/**
 * Ada writes one dialect of markdown; two surfaces render different ones.
 *
 * Telegram takes **bold**, WhatsApp takes *bold*. Sending Telegram's markup to
 * WhatsApp shows the asterisks to the user — on a money confirmation, where the
 * amount is the bolded part.
 */
test("bold survives the crossing", () => {
  assert.equal(toWhatsAppMarkup("**Sending ₦2,000**"), "*Sending ₦2,000*");
  assert.equal(toWhatsAppMarkup("To: **Kingsley**\n**Opay**"), "To: *Kingsley*\n*Opay*");
});

test("headings and code fences are stripped, not shown", () => {
  assert.equal(toWhatsAppMarkup("## Balance\nyou have"), "Balance\nyou have");
  assert.equal(toWhatsAppMarkup("```\n123\n```"), "\n123\n");
});

test("plain text is left exactly alone", () => {
  const s = "Reply with code #7 to confirm, or CANCEL.";
  assert.equal(toWhatsAppMarkup(s), s);
});
