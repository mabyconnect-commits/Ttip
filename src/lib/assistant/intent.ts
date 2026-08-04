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

export interface TransferIntent {
  /** Amount in the user's display currency. */
  amount: number;
  /** Raw destination text, e.g. "gtbank", "@kola", "my sister". */
  target: string | null;
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
  const q = normalize(text);
  const re = /(?:[₦$£€]\s*)?(\d[\d,]*(?:\.\d+)?)\s*(k|m|thousand|million)?/g;

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
  const q = normalize(text);
  if (!VERBS.some((v) => new RegExp(`(^|\\W)${v}(\\W|$)`).test(q))) return null;

  // A question about how transfers work is not a request to make one.
  if (/\b(how|what|why|where|can i|do i|does|explain|cost|fee|fees|limit)\b/.test(q)) return null;

  const amount = parseAmount(q);
  if (amount === null) return null;

  return { amount, target: parseTarget(q) };
}
