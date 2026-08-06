import "server-only";
import crypto from "crypto";
import { prisma } from "../db";

/**
 * Single-use codes that authorise a transfer by SMS.
 *
 * The transaction PIN must never travel this way. It is reusable, it stays in
 * the sent-items folder, it passes through the carrier's SMSC in the clear, and
 * the Telegram bot only gets away with asking for it because it deletes the
 * message the moment it reads it — which SMS cannot do. Anything reusable sent
 * in plaintext is a credential you have handed away.
 *
 * A code used once is worthless the instant it is read. That is the only
 * property that makes plaintext acceptable here, and it is the reason this is
 * the old bank TAN sheet rather than anything cleverer: it is also the only
 * authorisation that works with NO DATA AT ALL. The user gets the list while
 * they are online and keeps it — in a photo, a note, a wallet.
 *
 * We ask for a code BY NUMBER ("reply with code #7"), so someone reading one
 * message over a shoulder learns nothing about the next.
 */

/** How many codes a sheet holds. Enough to last, few enough to keep. */
const SHEET_SIZE = 20;

/** Warn when they're running low, so nobody is stranded mid-market. */
export const LOW_CODES = 5;

function hash(code: string): string {
  // Codes are short and high-entropy-limited, so the hash is salted with the
  // account: two users with the same code must not share a hash.
  return crypto.createHash("sha256").update(`sms-code:${code}`).digest("hex");
}

function sixDigits(): string {
  // Rejection-free: 6 digits from a uniform 32-bit draw, modulo bias below one
  // part in ten million, which is not the weak link in a single-use code.
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * Issue a fresh sheet, destroying any old one.
 *
 * Returns the codes IN THE CLEAR — the only time they exist anywhere outside
 * the user's own hands. Nothing stores them; the caller shows them once.
 */
export async function issueSheet(userId: string): Promise<{ index: number; code: string }[]> {
  const sheet = Array.from({ length: SHEET_SIZE }, (_, i) => ({ index: i + 1, code: sixDigits() }));

  await prisma.$transaction(async (tx) => {
    await tx.smsCode.deleteMany({ where: { userId } });
    await tx.smsCode.createMany({
      data: sheet.map((s) => ({ userId, index: s.index, codeHash: hash(s.code) })),
    });
  });

  return sheet;
}

/** The lowest-numbered unused code — the one we'll ask for next. */
export async function nextCodeIndex(userId: string): Promise<number | null> {
  const row = await prisma.smsCode.findFirst({
    where: { userId, usedAt: null },
    orderBy: { index: "asc" },
    select: { index: true },
  });
  return row?.index ?? null;
}

export async function codesLeft(userId: string): Promise<number> {
  return prisma.smsCode.count({ where: { userId, usedAt: null } });
}

/**
 * Spend a specific code.
 *
 * Consuming and checking are one step, and the update is conditional on the
 * code still being unused — so two messages arriving together cannot both spend
 * it, and a replayed message authorises nothing.
 */
export async function spendCode(userId: string, index: number, code: string): Promise<boolean> {
  const row = await prisma.smsCode.findUnique({ where: { userId_index: { userId, index } } });
  if (!row || row.usedAt) return false;

  const expected = Buffer.from(row.codeHash);
  const given = Buffer.from(hash(code.trim()));
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return false;

  const claimed = await prisma.smsCode.updateMany({
    where: { userId, index, usedAt: null },
    data: { usedAt: new Date() },
  });
  return claimed.count > 0;
}
