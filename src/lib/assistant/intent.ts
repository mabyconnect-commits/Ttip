/**
 * Spot a transfer request in something the user typed to Ada.
 *
 * "Hello Ada, help me transfer 7,500 to my GTBank account."
 *
 * Deliberately a plain parser, not the model. Two reasons:
 *
 *  1. An amount is the one thing that must never be hallucinated. A parser that
 *     reads 7,500 from the text cannot decide it was 75,000.
 *  2. It works identically whether or not an API key is configured.
 *
 * And it only ever produces a DRAFT. Ada cannot move money: the draft is shown
 * back to the user, who confirms it with their transaction PIN, and the normal
 * /api/send path then runs every check it always did. The destination has to be
 * a saved beneficiary or a Ttip @username — never an account number lifted out
 * of a chat message, which is exactly how someone gets talked into typing a
 * scammer's account into a chat window.
 *
 * Dependency-free so it's unit-testable.
 */

import { spokenBank } from "./bank-spoken";

export interface TransferIntent {
  /** Amount in the user's display currency. */
  amount: number;
  /** Raw destination text, e.g. "gtbank", "@kola", "my sister". */
  target: string | null;
  /** A 10-digit NUBAN pasted straight into the message. */
  account?: string;
  /** A bank named alongside it, e.g. "0123456789 Opay". */
  bank?: string;
}

const VERBS = [
  "transfer",
  "send",
  "withdraw",
  "cash out",
  "cashout",
  "pay out",
  "payout",
  "move",
  "ttip",
  "tip",
];

/** Words that follow an amount and mean "thousand" / "million" in casual writing. */
const SCALES: Record<string, number> = { k: 1_000, thousand: 1_000, m: 1_000_000, million: 1_000_000 };

function normalize(s: string): string {
  return (s ?? "").toLowerCase().replace(/['’]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * The first money-looking number in the text.
 * Handles "7,500", "₦7500", "7.5k", "50 thousand", "$20".
 */
export function parseAmount(text: string): number | null {
  // A spoken decimal comes back as a word. "0.05 SOL" said out loud is
  // transcribed "0Point05 Solana", and the parser then skipped the 0 and read
  // the 05 — turning 0.05 into 5, a hundredfold error on a number nobody
  // checked because nobody typed it.
  const q = normalize(text)
    .replace(/(\d)\s*(?:point|dot)\s*(\d)/g, "$1.$2")
    // "N5,000" and "NGN 5000" are how the naira is typed without its symbol.
    // Stripped here so the rule below — a number must not be welded to letters
    // — doesn't throw them away with the addresses.
    .replace(/\b(?:ngn|n)\s*(?=\d)/g, " ");

  // A number has to stand on its own.
  //
  // Digits stuck to letters belong to something else: a wallet address, an id,
  // a token. "0x742d…438f440" ends in 440 and was read as an amount of 440, and
  // a Solana address ending in digits did the same — so a QR could produce a
  // figure nobody had said, on a transfer that cannot be reversed. The scale
  // suffix must be a word of its own too: the "M" of "9136214038 Moniepoint"
  // was read as "million", turning an account number into ₦9,136,214,038,000,000.
  const re = /(?<![A-Za-z0-9.])(?:[₦$£€]\s*)?(\d[\d,]*(?:\.\d+)?)\s*(k|m|thousand|million)?(?![A-Za-z0-9])/g;

  for (const m of q.matchAll(re)) {
    const digits = m[1].replace(/,/g, "");
    let n = Number(digits);
    if (!Number.isFinite(n) || n <= 0) continue;

    const scale = m[2] ? SCALES[m[2]] : undefined;
    if (scale) n *= scale;

    // Skip things that clearly aren't amounts: a year, or a long digit string
    // that's really an account number.
    if (!m[2] && /^\d{10,}$/.test(digits)) continue;
    return n;
  }
  return null;
}

/**
 * A 10-digit Nigerian account number pasted into the message.
 *
 * This is the market case: photograph a vendor's account, paste it in, "send 5k
 * to this account". Deliberately strict about length — 10 digits is a NUBAN,
 * and anything else is far more likely to be an amount or a phone number.
 */
export function parseAccountNumber(text: string): string | undefined {
  const q = normalize(text).replace(/[\s-]/g, "");
  // Not preceded or followed by another digit, so a longer number isn't sliced.
  const m = q.match(/(?<!\d)(\d{10})(?!\d)/);
  if (!m) return undefined;
  // A Nigerian mobile number is 11 digits starting 0 — already excluded by the
  // length check, but a 10-digit string starting 0 is still a valid NUBAN.
  return m[1];
}

/** A bank named in the message, matched against the ones we can pay. */
export function parseBankName(text: string, banks: readonly string[]): string | undefined {
  const q = normalize(text);
  // Longest name first, so "Access Bank" wins over "Access".
  const sorted = [...banks].sort((a, b) => b.length - a.length);
  for (const b of sorted) {
    // "Opay (Paycom)" is written as "opay"; "Access Bank" as "access". Drop the
    // parenthetical alias and the generic words, then match what's left.
    const key = normalize(b)
      .replace(/\(.*?\)/g, " ")
      .replace(/\b(bank|plc|limited|ltd|mfb|microfinance)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (key.length >= 3 && new RegExp(`(^|\\W)${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\W|$)`).test(q)) return b;
  }
  // Then how people actually say it — "Money point", "o pay", "GT bank". A
  // voice note becomes text through a transcriber that has never heard of
  // Moniepoint, and that gap turned a one-sentence transfer into five.
  return spokenBank(text, banks);
}

/** The destination, if the message names one. */
export function parseTarget(text: string): string | null {
  const q = normalize(text);

  const handle = q.match(/@([a-z0-9_]{3,20})/);
  if (handle) return `@${handle[1]}`;

  // "... to my gtbank account", "... to kola", "... to my sister"
  const to = q.match(/\bto\s+(?:my\s+)?([a-z][a-z0-9 _'-]{1,40}?)(?:\s+(?:account|wallet|bank))?\s*[.?!]?$/);
  if (to) {
    const t = to[1].trim();
    if (t && !/^(bank|account|wallet)$/.test(t)) return t;
  }
  return null;
}

/**
 * Read a transfer request out of a message, or null when it isn't one.
 * Requires BOTH a verb and an amount — "what are your fees" must never be
 * mistaken for an instruction to move money.
 */
export function parseTransferIntent(text: string): TransferIntent | null {
  const parts = transferParts(text);
  if (!parts || parts.amount === null) return null;
  return { amount: parts.amount, target: parts.target, account: parts.account };
}

/**
 * A transfer request with its pieces separated, amount OPTIONAL.
 *
 * "Send to 9136214038 Moniepoint" is unmistakably someone trying to pay
 * someone, and it needs to be recognised as such even though it never says how
 * much — otherwise the follow-up that supplies the amount has nothing to attach
 * itself to. parseTransferIntent stays strict: it still refuses to return an
 * intent without an amount, because that's what decides whether money moves.
 */
export function transferParts(
  text: string,
): { amount: number | null; target: string | null; account?: string } | null {
  const q = normalize(text);
  if (!VERBS.some((v) => new RegExp(`(^|\\W)${v}(\\W|$)`).test(q))) return null;

  // A question about how transfers work is not a request to make one.
  if (/\b(how|what|why|where|can i|do i|does|explain|cost|fee|fees|limit)\b/.test(q)) return null;

  // Read the amount from the text WITHOUT the account number, so a pasted
  // 10-digit NUBAN can never be mistaken for what to send.
  const account = parseAccountNumber(q);
  const forAmount = account ? q.replace(account, " ") : q;
  return { amount: parseAmount(forAmount), target: parseTarget(q), account };
}


/* ------------------------------------------------------------------------ */
/* Bills: "Ada buy me ₦100 airtime", "send 1GB to my MTN line"               */
/* ------------------------------------------------------------------------ */

export interface BillIntent {
  category: "airtime" | "data";
  /** Naira amount, for airtime. */
  amountNgn?: number;
  /** Data size in MB, for data. 1GB → 1024. */
  sizeMb?: number;
  /** MTN | Glo | Airtel | 9mobile, when the message names one. */
  network?: string;
  /** An explicit phone number in the message, if there is one. */
  phone?: string;
}

const NETWORKS: [string, RegExp][] = [
  ["MTN", /\bmtn\b/],
  ["Glo", /\bglo\b|\bglobacom\b/],
  ["Airtel", /\bairtel\b/],
  ["9mobile", /\b9\s?mobile\b|\betisalat\b/],
];

/** Nigerian mobile number in any of the usual shapes. */
export function parsePhone(text: string): string | undefined {
  const q = normalize(text).replace(/[\s-]/g, "");
  const m = q.match(/(?:\+?234|0)(\d{10})/);
  if (!m) return undefined;
  return "0" + m[1];
}

/** "500mb", "1gb", "1.5 gb" → megabytes. */
export function parseDataSize(text: string): number | undefined {
  const m = normalize(text).match(/(\d+(?:\.\d+)?)\s*(mb|gb)\b/);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return m[2] === "gb" ? n * 1024 : n;
}

/**
 * Read an airtime or data purchase out of a message, or null when it isn't one.
 *
 * As with transfers, the amount comes from a parser rather than the model — a
 * misread "₦100" as "₦1,000" is money out of someone's balance. And a question
 * about airtime is not an instruction to buy any.
 */
export function parseBillIntent(text: string): BillIntent | null {
  const q = normalize(text);

  const wantsAirtime = /\b(airtime|recharge|credit|top\s?up|topup)\b/.test(q);
  const size = parseDataSize(q);
  const wantsData = /\bdata\b/.test(q) || size !== undefined;
  if (!wantsAirtime && !wantsData) return null;

  // "how much is 1GB of data" is a question, not a purchase.
  if (/\b(how|what|why|where|can i|do i|does|explain|cost|price|fee|fees)\b/.test(q)) return null;
  // Needs an intent to buy, so "my data finished" isn't read as an order.
  if (!/\b(buy|get|send|recharge|top\s?up|topup|load|purchase|credit|fund)\b/.test(q)) return null;

  const network = NETWORKS.find(([, re]) => re.test(q))?.[0];
  const phone = parsePhone(q);

  if (wantsData && size !== undefined) {
    return { category: "data", sizeMb: size, network, phone };
  }

  // Airtime needs a naira amount. Ignore a phone number when reading it.
  const withoutPhone = q.replace(/(?:\+?234|0)\d{10}/g, " ");
  const amountNgn = parseAmount(withoutPhone);
  if (wantsAirtime && amountNgn) return { category: "airtime", amountNgn, network, phone };

  // "buy me data" with no size — still a purchase, the app asks for the rest.
  if (wantsData) return { category: "data", network, phone };
  return null;
}

/* ------------------------------------------------------------------------ */
/* Transfers spread across turns                                            */
/* ------------------------------------------------------------------------ */

/**
 * A transfer the user built up over several messages.
 *
 * Real conversations don't arrive in one sentence. Someone pastes an account,
 * Ada asks how much, and they reply "1000" — and parseTransferIntent sees a
 * bare number with no verb and returns nothing. The result was Ada describing a
 * transfer in prose while no confirm card was ever created: the model would say
 * "tap confirm and enter your PIN" and there was nothing on screen to tap. One
 * user, reasonably, typed their PIN into the chat instead.
 *
 * So the last message is allowed to complete an earlier one — but narrowly:
 *
 *  - the last message must be an ANSWER, not a new sentence. Once its amount
 *    and account are removed, almost nothing may be left. "1000" completes a
 *    transfer; "what's 1000 naira in dollars" does not.
 *  - it must contribute the missing piece itself, so an unrelated message can
 *    never re-fire a transfer the user already finished.
 *  - the earlier message it completes must have been a transfer request, verb
 *    and all.
 *
 * The user still sees the amount and the bank-confirmed name on the card, and
 * still enters a PIN. This decides whether a card appears — not whether money
 * moves.
 */
export interface FollowUpIntent extends TransferIntent {
  /**
   * The messages this was assembled from, joined. The caller parses the bank
   * name out of this rather than the last message alone — "Moniepoint" is
   * usually typed with the account, one turn before the amount.
   */
  sourceText: string;
}

export function parseFollowUpIntent(
  history: { role: "user" | "assistant"; content: string }[],
): FollowUpIntent | null {
  const last = history[history.length - 1];
  if (!last || last.role !== "user") return null;

  // A complete request needs no help.
  const direct = parseTransferIntent(last.content);
  if (direct) return { ...direct, sourceText: last.content };

  const amount = parseAmount(last.content);
  const account = parseAccountNumber(last.content);
  if (!amount && !account) return null;
  if (!isBareAnswer(last.content, amount, account)) return null;

  // Walk back over the recent user turns for the request this answers.
  const earlier = history
    .slice(0, -1)
    .filter((m) => m.role === "user")
    .slice(-3)
    .reverse();

  for (const msg of earlier) {
    // Looser than parseTransferIntent on purpose: the earlier message is
    // usually the one MISSING the amount, which is why we're here at all.
    const prior = transferParts(msg.content);
    if (!prior) continue;
    // It has to name a destination, or there's nothing to complete.
    if (!prior.account && !prior.target) continue;

    const finalAmount = amount ?? prior.amount;
    if (finalAmount === null) continue;

    const merged: FollowUpIntent = {
      // Whatever the last message supplied wins — it's the newer instruction.
      amount: finalAmount,
      target: prior.target,
      account: account ?? prior.account,
      sourceText: `${msg.content} ${last.content}`,
    };

    // Only accept when the last message actually completed something. If the
    // earlier request was already whole, this is a new message about an old
    // transfer, not an answer to a question.
    const wasIncomplete = prior.amount === null || (!prior.account && !prior.target);
    const contributed = (amount && amount !== prior.amount) || (account && account !== prior.account);
    if (wasIncomplete || contributed) return merged;
  }

  return null;
}

/**
 * Is this message just the answer to a question?
 *
 * "1000", "₦1,000", "9136214038 Moniepoint" — yes. Anything with a sentence
 * around it is a new thought and must not silently complete an old transfer.
 */
function isBareAnswer(text: string, amount: number | null, account?: string): boolean {
  let rest = normalize(text);
  if (account) rest = rest.replace(/[\s-]/g, " ").replace(new RegExp(account.split("").join("[\\s-]*")), " ");
  if (amount !== null) rest = rest.replace(/(?:[₦$£€]\s*)?\d[\d,]*(?:\.\d+)?\s*(k|m|thousand|million)?/g, " ");

  // Filler that doesn't make it a sentence: a bank name, "naira", "please".
  const words = rest
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !FILLER.has(w));

  return words.length <= 3;
}

const FILLER = new Set([
  "naira", "ngn", "please", "pls", "abeg", "ok", "okay", "yes", "yeah", "sure",
  "send", "it", "to", "the", "my", "account", "bank", "and", "thanks", "thank",
  "mfb", "microfinance", "plc", "limited", "ltd",
]);
