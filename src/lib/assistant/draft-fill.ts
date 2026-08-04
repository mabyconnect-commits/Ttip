/**
 * Filling in a half-finished transfer from the next thing someone says.
 *
 * A transfer needs three things: an account, a bank, and an amount. People do
 * not deliver all three in one sentence, and there is no reason they should —
 * they say the number, then the bank when asked, then how much. Every time this
 * app has insisted on all three at once, the conversation has gone in circles:
 * a question asked, answered, and then asked again, ending in Ada telling
 * someone to re-type their request "as one line so the parser picks it up".
 *
 * So this reads whatever the latest message adds and nothing more. Pure and
 * dependency-free, because it is the part that keeps breaking and it needs to
 * be testable without a database or a chat.
 */

import { parseAmount, parseBankName } from "./intent";

export interface DraftState {
  kind?: string | null;
  amount: number | null;
  accountNumber?: string | null;
  bankName?: string | null;
}

/** What this message adds to the draft. Empty when it adds nothing. */
export interface Fill {
  amount?: number;
  bank?: string;
}

/**
 * A message that is asking rather than answering.
 *
 * "What's 1,000 naira in dollars" contains a number and is not an amount. Only
 * checked for amounts: "which bank? — Moniepoint" is an answer even though the
 * question word came along for the ride.
 */
const ASKING = /\b(what|why|how|when|where|which|can i|do i|is it|does)\b/i;

export function fillFromReply(
  draft: DraftState,
  text: string,
  banks: readonly string[],
): Fill {
  const out: Fill = {};
  const body = (text ?? "").trim();
  if (!body) return out;

  const crypto = draft.kind === "crypto";

  // A chain has no bank, so a bank name in a crypto message means nothing.
  if (!crypto && !draft.bankName) {
    const bank = parseBankName(body, banks);
    if (bank) out.bank = bank;
  }

  if (draft.amount === null && !ASKING.test(body)) {
    const amount = parseAmount(body);
    if (amount) out.amount = amount;
  }

  return out;
}

/** What the draft still needs, or null when it's ready to confirm. */
export function draftGap(draft: DraftState): "bank" | "amount" | null {
  if (draft.kind !== "crypto" && !draft.bankName) return "bank";
  if (draft.amount === null) return "amount";
  return null;
}
