import "server-only";
import { createHash, randomBytes } from "crypto";
import { prisma } from "./db";

/**
 * Linking a Telegram chat to a Ttip account.
 *
 * The bot used to answer product questions only, because a Telegram chat id
 * proves nothing — anyone can message a bot and claim to be anyone. That left a
 * hole: the person messaging Ada on Telegram is almost always a real Ttip user
 * who wants to know their own balance, and telling them to go and open the app
 * makes the bot close to useless.
 *
 * This closes it without inventing a login inside a chat window. The token is
 * minted INSIDE the signed-in app and carried to Telegram in a t.me deep link,
 * so possession of the link is proof the holder was signed in seconds earlier.
 * Nothing secret is ever typed into the chat: no password, no PIN, no BVN — the
 * exact things a phishing bot would ask for, which is what makes "never type
 * those into Telegram" advice we can still give honestly.
 *
 * Defence in depth:
 *  - only a SHA-256 of the token is stored, so a database leak links nobody;
 *  - single use, and dead after `TOKEN_TTL_MIN` minutes;
 *  - one Telegram account maps to at most one Ttip account (unique column), so
 *    a linked chat can't be quietly re-pointed at a second account;
 *  - linking is reversible from either side (/unlink in chat, or the app).
 */

const TOKEN_TTL_MIN = 15;
/** Long enough that guessing is hopeless; short enough for a tidy t.me link. */
const TOKEN_BYTES = 24;

export function hashLinkToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Mints a one-time link token for a signed-in user. Returns the RAW token. */
export async function createLinkToken(userId: string): Promise<string> {
  // Old tokens for this user are useless the moment a new one is minted, and
  // leaving them alive would widen the window for a link shared by mistake.
  await prisma.telegramLinkToken.deleteMany({ where: { userId, usedAt: null } });

  const raw = randomBytes(TOKEN_BYTES).toString("base64url");
  await prisma.telegramLinkToken.create({
    data: {
      userId,
      tokenHash: hashLinkToken(raw),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MIN * 60_000),
    },
  });
  return raw;
}

export type LinkResult =
  | { ok: true; userId: string; name: string }
  | { ok: false; reason: "invalid" | "expired" | "used" | "chat_taken" };

/**
 * Redeems a token and binds `chatId` to the account that minted it.
 * Every failure mode is distinct so the bot can say something useful instead of
 * a generic "that didn't work".
 */
export async function redeemLinkToken(
  raw: string,
  chatId: number | string,
  telegramUsername?: string | null,
): Promise<LinkResult> {
  const token = await prisma.telegramLinkToken.findUnique({
    where: { tokenHash: hashLinkToken(raw) },
    include: { user: { select: { id: true, name: true } } },
  });

  if (!token) return { ok: false, reason: "invalid" };
  if (token.usedAt) return { ok: false, reason: "used" };
  if (token.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };

  const id = String(chatId);

  // This Telegram account may already be attached to a DIFFERENT Ttip account.
  // Silently moving it would let someone who once linked their chat hand it to
  // a second account and read both, so it's refused and has to be unlinked
  // first — deliberately, from the side that already holds it.
  const existing = await prisma.user.findUnique({ where: { telegramChatId: id }, select: { id: true } });
  if (existing && existing.id !== token.userId) return { ok: false, reason: "chat_taken" };

  await prisma.$transaction([
    prisma.telegramLinkToken.update({ where: { id: token.id }, data: { usedAt: new Date() } }),
    prisma.user.update({
      where: { id: token.userId },
      data: {
        telegramChatId: id,
        telegramUsername: telegramUsername ?? null,
        telegramLinkedAt: new Date(),
      },
    }),
  ]);

  return { ok: true, userId: token.userId, name: token.user.name };
}

/** The Ttip account behind a Telegram chat, or null when it isn't linked. */
export async function userForChat(chatId: number | string) {
  return prisma.user.findUnique({
    where: { telegramChatId: String(chatId) },
    select: { id: true, name: true, username: true, kycTier: true, kycStatus: true, nairaAccount: true, nairaBank: true },
  });
}

/** Unlinks whichever account holds this chat. Returns true if one did. */
export async function unlinkChat(chatId: number | string): Promise<boolean> {
  const res = await prisma.user.updateMany({
    where: { telegramChatId: String(chatId) },
    data: { telegramChatId: null, telegramUsername: null, telegramLinkedAt: null },
  });
  return res.count > 0;
}
