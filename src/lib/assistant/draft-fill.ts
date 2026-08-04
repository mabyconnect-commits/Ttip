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

/**
 * "Go on then" — a message that asks to proceed rather than saying anything new.
 *
 * Kept tight on purpose. This is what lets a transfer be rebuilt from the
 * conversation, and a loose match would put a confirmation card in front of
 * someone who was only chatting.
 */
const PROCEED =
  /^(?:ok(?:ay)?|yes|yeah|yep|sure|alright|please|abeg)?\s*(?:go\s*ahead|go\s*on|proceed|continue|confirm|do\s*it|send\s*(?:it|now|am|that)?|now)\b|^(?:ok(?:ay)?|yes|yeah|yep|sure)[\s.!]*$/i;

export function wantsToProceed(text: string): boolean {
  return PROCEED.test((text ?? "").trim());
}

/**
 * Rebuild a transfer from what was already said.
 *
 * A conversation can arrive at all three pieces and still have nothing to show
 * for it — the account in one message, the bank in the next, the amount in a
 * third, and then a gap where the user goes away and comes back. Ada could see
 * the history and say "I've got all three pieces: ₦1,500 to 9136214038,
 * Moniepoint", and still not be able to put a confirmation in front of anyone,
 * because only a parser can set one up and the parser was only ever shown the
 * newest message.
 *
 * So when someone asks to go ahead, the pieces are read back out of the
 * conversation. Newest first, so a corrected amount wins over the one it
 * replaced. Nothing is sent by this — it produces a confirmation the user still
 * has to approve with their PIN.
 */
export function assembleFromHistory(
  turns: readonly { role: string; text: string }[],
  banks: readonly string[],
  parseAccount: (text: string) => string | undefined,
): { account?: string; bank?: string; amount?: number } {
  const out: { account?: string; bank?: string; amount?: number } = {};

  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const text = (turns[i]?.text ?? "").trim();
    if (!text) continue;

    if (!out.account) {
      const account = parseAccount(text);
      if (account) out.account = account;
    }
    if (!out.bank) {
      const bank = parseBankName(text, banks);
      if (bank) out.bank = bank;
    }
    // An amount is only ever taken from something the USER said. Ada's own
    // messages quote figures back — a fee, a balance, an example — and a number
    // she wrote must never become the number that gets sent.
    if (!out.amount && turns[i].role === "user" && !ASKING.test(text)) {
      const amount = parseAmount(text);
      if (amount) out.amount = amount;
    }
    if (out.account && out.bank && out.amount) break;
  }

  return out;
}
