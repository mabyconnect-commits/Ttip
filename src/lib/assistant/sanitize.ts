/**
 * Clean the assistant's text before it reaches the screen.
 *
 * The reference app we were shown leaks raw tool syntax into the chat — a user
 * asking a normal question got back
 *   <function=join_waitlist>{"name": "your name", ...}</function>
 * printed in the bubble. That happens when a model emits call-shaped markup as
 * plain text and the UI renders whatever it receives.
 *
 * The prompt tells Ada never to emit markup; this is the belt to that braces.
 * Prompts are guidance, output is a fact — so the last thing before rendering
 * strips anything tag-shaped. It runs incrementally on the stream too, which is
 * why partial/unclosed tags are handled.
 *
 * Dependency-free so it can be unit-tested and reused on the client.
 */

/** Marker the model uses to ask for a human. Removed from the visible text. */
export const ESCALATE_MARKER = "[[ESCALATE]]";

/** Complete call-shaped blocks, e.g. <function=x>{...}</function> or <invoke ...>…</invoke>. */
const BLOCK = /<\s*(function|invoke|antml:invoke|tool_use|tool_call|thinking|antml:thinking)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;

/** An opening call-shaped tag whose closer never arrived (a truncated stream). */
const DANGLING = /<\s*(function|invoke|antml:invoke|tool_use|tool_call|thinking|antml:thinking)\b[\s\S]*$/i;

/** Any other lone tag: <foo>, </foo>, <foo bar="1" />. */
const TAG = /<\s*\/?\s*[a-zA-Z][a-zA-Z0-9:_-]*(\s[^<>]*)?\/?\s*>/g;

/** A tag that has been opened but not yet closed at the end of a chunk. */
const PARTIAL_TAG = /<[^<>]*$/;

export interface CleanResult {
  /** Text safe to render. */
  text: string;
  /** True when the model asked for a human to take over. */
  escalate: boolean;
}

/**
 * Strip markup and the escalation marker from a complete message.
 *
 * `streaming` keeps a trailing partial tag (`"<fun"`) out of the output rather
 * than treating it as literal text, so a tag split across two stream chunks is
 * never briefly visible.
 */
export function cleanAssistantText(raw: string, streaming = false): CleanResult {
  let text = raw ?? "";

  const escalate = text.includes(ESCALATE_MARKER);
  text = text.split(ESCALATE_MARKER).join("");

  text = text.replace(BLOCK, "");
  text = text.replace(DANGLING, "");
  text = text.replace(TAG, "");
  if (streaming) text = text.replace(PARTIAL_TAG, "");

  // Collapse the blank space left behind by anything removed.
  text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");

  return { text: streaming ? text : text.trim(), escalate };
}
