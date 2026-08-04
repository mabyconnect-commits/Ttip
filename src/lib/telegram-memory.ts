import "server-only";
import { prisma } from "./db";
import type { Turn, TurnRole } from "./assistant/conversation";

/**
 * What was already said in this Telegram chat.
 *
 * A webhook is one HTTP request per message, so without this the model is
 * handed exactly one sentence and genuinely knows nothing else — which is why
 * Ada could ask for an account, be given one, ask how much, be told, and then
 * ask who all over again. She wasn't forgetting; she was never told.
 *
 * Deliberately small: the last stretch of the same conversation, capped in both
 * directions. This is a chat window, not a transcript archive.
 *
 * Nothing here may ever throw. Losing the history should cost the model some
 * context; it must never cost the user their answer or their transfer.
 */

/** Older than this and it isn't the same conversation any more. */
const WINDOW_MS = 90 * 60_000;
/** How many turns the model is shown. */
const MAX_TURNS = 14;
/** How many are kept per chat at all — the rest are pruned on write. */
const KEEP_PER_CHAT = 30;
/** The column is VarChar(2000); a long answer is truncated, not rejected. */
const MAX_LEN = 2000;

export type { Turn, TurnRole };

/** A message that is nothing but 4–6 digits — i.e. a PIN. Never stored. */
const LOOKS_LIKE_PIN = /^\d{4,6}$/;

/**
 * Record one side of the conversation.
 *
 * PINs are refused here as well as at the call site. The webhook already
 * returns before this is reached for a PIN, but a secret is not something to
 * protect in exactly one place — the cost of the second check is a regex.
 */
export async function rememberTurn(
  chatId: number | string,
  role: TurnRole,
  text: string,
): Promise<void> {
  const body = (text ?? "").trim();
  if (!body || LOOKS_LIKE_PIN.test(body)) return;

  try {
    await prisma.telegramTurn.create({
      data: { chatId: String(chatId), role, text: body.slice(0, MAX_LEN) },
    });
    await prune(String(chatId));
  } catch (e) {
    console.error("[telegram-memory] could not record turn", e);
  }
}

/** Drop everything past the newest KEEP_PER_CHAT for this chat. */
async function prune(chatId: string): Promise<void> {
  const edge = await prisma.telegramTurn.findMany({
    where: { chatId },
    orderBy: { createdAt: "desc" },
    skip: KEEP_PER_CHAT,
    take: 1,
    select: { createdAt: true },
  });
  if (!edge.length) return;
  await prisma.telegramTurn.deleteMany({
    where: { chatId, createdAt: { lte: edge[0].createdAt } },
  });
}

/** The recent conversation, oldest first. Empty when there is none. */
export async function recentTurns(chatId: number | string): Promise<Turn[]> {
  try {
    const rows = await prisma.telegramTurn.findMany({
      where: { chatId: String(chatId), createdAt: { gte: new Date(Date.now() - WINDOW_MS) } },
      orderBy: { createdAt: "desc" },
      take: MAX_TURNS,
      select: { role: true, text: true },
    });
    return rows
      .reverse()
      .map((r) => ({ role: r.role === "assistant" ? "assistant" : "user", text: r.text }) as Turn);
  } catch (e) {
    console.error("[telegram-memory] could not read history", e);
    return [];
  }
}

/** Forget this chat entirely — on unlink, and on a fresh link. */
export async function forgetChat(chatId: number | string): Promise<void> {
  try {
    await prisma.telegramTurn.deleteMany({ where: { chatId: String(chatId) } });
  } catch (e) {
    console.error("[telegram-memory] could not clear history", e);
  }
}
