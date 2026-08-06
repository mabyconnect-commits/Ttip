/**
 * Reading a text message as an instruction.
 *
 * A phone with no data has 160 characters and no keyboard worth typing on, so
 * this has to work with whatever someone thumbs in one-handed on a feature
 * phone: "send 2k to mama", "SEND 2000 MAMA", "bal", "balance?".
 *
 * Deliberately narrow. The Telegram parser can afford to be generous because a
 * misread there produces a confirmation card the user reads before anything
 * moves. Here the reply costs money to send and the round trip is slow, so
 * anything ambiguous becomes a question rather than a guess — and an
 * unrecognised message becomes help, never an attempted transfer.
 *
 * Pure and dependency-free: this is the part that decides whether money moves,
 * and it needs to be testable without a database or a carrier.
 */

export type SmsCommand =
  | { kind: "balance" }
  | { kind: "list" }
  | { kind: "help" }
  | { kind: "cancel" }
  /** "SEND 2000 MAMA" — an amount and who, by saved name. */
  | { kind: "send"; amount: number; to: string }
  /** A bare code answering "reply with code #7". */
  | { kind: "code"; code: string }
  | { kind: "unknown" };

const BALANCE = /^(?:bal|balance|bals?)\b\??$/i;
const LIST = /^(?:list|who|names?|beneficiar(?:y|ies))\b\??$/i;
const HELP = /^(?:help|info|menu|start|\?)\b\??$/i;
const CANCEL = /^(?:cancel|stop|no|abort)\b\??$/i;

/** 4–8 digits on their own — the answer to "reply with code #7". */
const BARE_CODE = /^(\d{4,8})$/;

/**
 * "send 2000 to mama", "SEND 2K MAMA", "send mama 2000".
 *
 * The name is whatever is left once the verb, the amount and the filler words
 * are taken out — so "send 5k to my sister" looks for "my sister" and finds the
 * beneficiary saved as "Sister". Matching that name is the caller's job; this
 * only decides what the user typed.
 */
const SEND = /^(?:send|pay|transfer)\b/i;

/** "2k" → 2000, "1.5m" → 1500000, "2,000" → 2000. */
function parseMoney(token: string): number | null {
  const m = token.replace(/,/g, "").match(/^₦?(\d+(?:\.\d+)?)(k|m)?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const mult = m[2]?.toLowerCase() === "k" ? 1_000 : m[2]?.toLowerCase() === "m" ? 1_000_000 : 1;
  return n * mult;
}

const FILLER = new Set(["to", "for", "my", "the", "naira", "ngn", "please", "pls", "abeg", "now"]);

export function parseSms(text: string): SmsCommand {
  const body = (text ?? "").trim().replace(/\s+/g, " ");
  if (!body) return { kind: "unknown" };

  if (BALANCE.test(body)) return { kind: "balance" };
  if (LIST.test(body)) return { kind: "list" };
  if (HELP.test(body)) return { kind: "help" };
  if (CANCEL.test(body)) return { kind: "cancel" };

  const bare = body.match(BARE_CODE);
  if (bare) return { kind: "code", code: bare[1] };

  if (!SEND.test(body)) return { kind: "unknown" };

  const words = body.split(" ").slice(1); // drop the verb
  let amount: number | null = null;
  const nameParts: string[] = [];

  for (const w of words) {
    const money: number | null = amount === null ? parseMoney(w) : null;
    if (money !== null) {
      amount = money;
      continue;
    }
    const clean = w.replace(/[^\w'-]/g, "");
    if (!clean || FILLER.has(clean.toLowerCase())) continue;
    nameParts.push(clean);
  }

  const to = nameParts.join(" ").trim();
  // Both halves or nothing. "send 2000" with no name, or a name with no amount,
  // is a message we answer with a question — never a transfer to a guess.
  if (amount === null || !to) return { kind: "unknown" };
  return { kind: "send", amount, to };
}

/**
 * Which saved beneficiary they meant, or null when it isn't obvious.
 *
 * ONE match or nothing. Two candidates means we ask, because picking between
 * them sends money to the wrong person — and over SMS the user finds out after
 * it's gone rather than on a confirmation screen.
 */
export function matchName<T extends { name: string; handle?: string | null }>(
  query: string,
  saved: readonly T[],
): T | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;

  const exact = saved.filter((b) => b.name.trim().toLowerCase() === q);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;

  // A whole word, so "ama" can't match "Amara" and "Sister" matches "My Sister".
  const word = new RegExp(`(^|\\s)${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`, "i");
  const hits = saved.filter((b) => word.test(b.name));
  return hits.length === 1 ? hits[0] : null;
}
