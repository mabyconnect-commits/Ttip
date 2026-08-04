/**
 * Turning what was said in a chat into a `messages` array the model accepts.
 *
 * Kept separate from the storage (lib/telegram-memory.ts) and dependency-free
 * so it can be unit-tested: this is the piece that decides what Ada remembers,
 * and a bad array here doesn't degrade the answer — it makes the API reject the
 * call, which drops her back to the built-in replies with no memory at all.
 */

export type TurnRole = "user" | "assistant";

export interface Turn {
  role: TurnRole;
  text: string;
}

/**
 * The API requires roles to alternate and the first message to come from the
 * user. Stored history satisfies neither on its own: Ada sends several messages
 * in a row while setting up a transfer, and a window can easily open on one of
 * them — a photo produces "Got it — 9136214038 at Moniepoint. How much should I
 * send?" with no typed question in front of it.
 *
 * So consecutive turns of the same role are merged, and an opening answer is
 * given something to follow rather than being discarded, because that answer is
 * usually the very context worth keeping.
 *
 * The current question always ends the array — the model must be replying to
 * the user, never to itself.
 */
export function conversationMessages(
  turns: Turn[],
  question: string,
): { role: TurnRole; content: string }[] {
  const out: { role: TurnRole; content: string }[] = [];
  for (const t of turns) {
    const text = (t.text ?? "").trim();
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.content += `\n${text}`;
    else out.push({ role: t.role, content: text });
  }

  if (out.length && out[0].role === "assistant") {
    out.unshift({ role: "user", content: "(earlier in this chat)" });
  }

  const q = (question ?? "").trim();
  if (!q) {
    if (out[out.length - 1]?.role === "assistant") out.pop();
    return out.length === 1 && out[0].content === "(earlier in this chat)" ? [] : out;
  }

  const tail = out[out.length - 1];
  if (tail?.role === "user") {
    // The current message is normally already the last stored turn; only add it
    // when it isn't, so the model isn't shown the same sentence twice.
    if (!tail.content.trim().endsWith(q)) tail.content += `\n${q}`;
  } else {
    out.push({ role: "user", content: q });
  }
  return out;
}
