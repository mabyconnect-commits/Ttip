/**
 * Turn Ada's Markdown into something Telegram actually renders.
 *
 * Telegram renders NO Markdown unless you ask for a parse_mode, so a message
 * containing `**Tier 2 (Verified)**` arrives with the asterisks visible. In the
 * app Ada's answers are rendered by a Markdown component and look right; on
 * Telegram the identical text looked like a broken export. Same words, and the
 * chat felt cheap because of punctuation.
 *
 * Two ways to fix that, and the safer one is not the obvious one:
 *
 *   - hand Telegram the raw Markdown with parse_mode: "MarkdownV2". Telegram's
 *     dialect requires escaping about sixteen characters — including `.`, `-`
 *     and `!` — and rejects the WHOLE message if one is wrong. A single stray
 *     hyphen from the model and the user gets silence.
 *
 *   - escape everything to HTML first, so nothing in the input can be markup,
 *     then add the handful of tags we chose ourselves. Malformed output becomes
 *     impossible rather than unlikely, because the only tags in the string are
 *     the ones this file put there.
 *
 * This is the second. Dependency-free so it can be unit-tested.
 */

/** Telegram's HTML mode needs exactly these three escaped. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Markdown → Telegram HTML.
 *
 * Supports the subset Ada actually uses: bold, italic, inline code, links,
 * bullets and headings. Everything else is left as readable text — an
 * unsupported construct should look plain, never broken.
 */
export function toTelegramHtml(raw: string): string {
  // Escape FIRST. After this line nothing in the user's or model's text can
  // possibly be a tag, so every tag added below is one we control.
  let s = escapeHtml(raw ?? "");

  // Fenced code blocks, before anything else can chew on their contents.
  s = s.replace(/```[a-zA-Z]*\n([\s\S]*?)```/g, (_m, code) => `<pre>${code.replace(/\n+$/, "")}</pre>`);

  // Headings: Telegram has none, so they become a bold line.
  s = s.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");

  // Bold before italic, so ** isn't eaten by the single-asterisk rule.
  s = s.replace(/\*\*([^\n*]+?)\*\*/g, "<b>$1</b>");
  s = s.replace(/__([^\n_]+?)__/g, "<b>$1</b>");

  // Italic. The marker must hug its text — "2 * 3 * 4" is multiplication, not
  // an italic " 3 " — and must follow whitespace, so snake_case identifiers
  // survive intact.
  s = s.replace(/(^|[\s(])\*(?!\s)([^\n*]+?)(?<!\s)\*(?=[\s.,;:!?)]|$)/g, "$1<i>$2</i>");
  s = s.replace(/(^|[\s(])_(?!\s)([^\n_]+?)(?<!\s)_(?=[\s.,;:!?)]|$)/g, "$1<i>$2</i>");

  s = s.replace(/`([^`\n]+?)`/g, "<code>$1</code>");

  // [label](url) — only http(s), so nothing can smuggle in a javascript: link.
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');

  // Bullets. A leading "- " reads as a dash in a chat bubble; "•" reads as a
  // list. Numbered lists already look fine and are left alone.
  s = s.replace(/^[ \t]*[-*+][ \t]+/gm, "• ");

  // Horizontal rules have no meaning in a chat bubble.
  s = s.replace(/^\s*([-*_])\1{2,}\s*$/gm, "");

  return s.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Strip Markdown to readable plain text.
 *
 * The fallback when Telegram refuses the HTML: the message still has to arrive,
 * just without the styling. Silence is the one outcome that isn't acceptable.
 */
export function toPlainText(raw: string): string {
  let s = raw ?? "";
  s = s.replace(/```[a-zA-Z]*\n([\s\S]*?)```/g, "$1");
  s = s.replace(/^#{1,6}\s+/gm, "");
  s = s.replace(/\*\*([^\n*]+?)\*\*/g, "$1");
  s = s.replace(/__([^\n_]+?)__/g, "$1");
  s = s.replace(/(^|[\s(])\*(?!\s)([^\n*]+?)(?<!\s)\*(?=[\s.,;:!?)]|$)/g, "$1$2");
  s = s.replace(/`([^`\n]+?)`/g, "$1");
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)");
  s = s.replace(/^[ \t]*[-*+][ \t]+/gm, "• ");
  return s.replace(/\n{3,}/g, "\n\n").trim();
}
