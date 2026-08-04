import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { telegramEnabled, botUsername } from "@/lib/telegram";
import { createLinkToken } from "@/lib/telegram-link";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Connect / disconnect the signed-in account and Telegram.
 *
 * GET    — is this account linked, and to which Telegram handle
 * POST   — mint a one-time deep link the user taps to connect
 * DELETE — disconnect
 *
 * The token is minted HERE, behind the session cookie, which is the whole
 * security argument: the person who receives the link was signed in when they
 * asked for it. Nothing secret ever travels through the chat.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { telegramChatId: true, telegramUsername: true, telegramLinkedAt: true },
  });

  return NextResponse.json({
    available: telegramEnabled(),
    linked: !!user?.telegramChatId,
    handle: user?.telegramUsername ?? null,
    linkedAt: user?.telegramLinkedAt ?? null,
  });
}

export async function POST() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!telegramEnabled()) return NextResponse.json({ error: "Telegram isn't set up yet." }, { status: 503 });

  try {
    rateLimit(`tg-link:${userId}`, { limit: 6, windowMs: 10 * 60_000 });
  } catch {
    return NextResponse.json({ error: "Too many attempts — try again in a few minutes." }, { status: 429 });
  }

  const bot = await botUsername();
  if (!bot) {
    return NextResponse.json({ error: "Couldn't reach the Telegram bot. Try again shortly." }, { status: 502 });
  }

  const token = await createLinkToken(userId);
  return NextResponse.json({ url: `https://t.me/${bot}?start=${token}`, bot, expiresInMinutes: 15 });
}

export async function DELETE() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  await prisma.$transaction([
    prisma.telegramLinkToken.deleteMany({ where: { userId } }),
    prisma.user.update({
      where: { id: userId },
      data: { telegramChatId: null, telegramUsername: null, telegramLinkedAt: null },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
