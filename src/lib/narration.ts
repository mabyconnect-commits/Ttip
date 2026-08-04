/**
 * Clean a user-written transfer description before it goes to the bank.
 *
 * Nigerian transfers carry a narration and people rely on it — "rent March",
 * "invoice 204", "for the goods" — because it's what shows up on the
 * recipient's statement and how they work out who paid for what. Sending
 * everything as "Ttip payout" made every transfer look identical.
 *
 * Bank rails are fussy about narrations: they're a fixed-width field on old
 * systems, and a stray character can get a transfer rejected by the receiving
 * bank rather than by us — which is the worst place to find out. So this keeps
 * it to characters that survive everywhere, and truncates rather than fails.
 *
 * Dependency-free so both the client and the server run exactly the same rules.
 */

/** Most rails cap the narration around 100 characters; stay comfortably inside. */
export const NARRATION_MAX = 90;

export function cleanNarration(input: string | null | undefined): string {
  return (input ?? "")
    .normalize("NFKD")
    // Keep letters, digits, space and the punctuation banks reliably accept.
    .replace(/[^a-zA-Z0-9 .,\-_/&()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NARRATION_MAX)
    .trim();
}

/**
 * The narration actually sent to the bank. Falls back to a sensible default so
 * a transfer never goes out with an empty field, which some banks reject.
 */
export function payoutNarration(input: string | null | undefined, fallback = "Ttip payout"): string {
  const clean = cleanNarration(input);
  return clean || fallback;
}
