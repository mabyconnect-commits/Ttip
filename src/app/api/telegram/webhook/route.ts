import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { sendMessage, sendTyping, telegramEnabled, telegramWebhookSecret, telegramWelcome } from "@/lib/telegram";
import { answerFaq } from "@/lib/assistant/faq";
import { assistantRules, ttipKnowledge } from "@/lib/assistant/knowledge";
import { cleanAssistantText } from "@/lib/assistant/sanitize";
import { buildUserContext } from "@/lib/assistant/context";
import { redeemLinkToken, userForChat, unlinkChat } from "@/lib/telegram-link";
import { bankAliases } from "@/lib/bank-aliases";
import { rateLimit } from "@/lib/rate-limit";
import { COMPANY } from "@/lib/company";

/**
 * The Ttip Telegram bot.
 *
 * Same brain as Ada in the app — the model when a key is configured, the
 * built-in answers when it isn't.
 *
 * A raw Telegram chat id proves nothing: anyone can message a bot. So the bot
 * knows who it's talking to ONLY when that chat has been linked from inside the
 * signed-in app (see lib/telegram-link.ts), which is proof, not a claim. Linked,
 * Ada answers about the real account. Unlinked, she answers product questions
 * and offers the one-tap link instead of pretending she can see anything.
 *
 * What a linked chat can do is deliberately bounded to READING. Nothing here
 * moves money, and nothing here asks for a PIN — a chat window is the wrong
 * place for both, and a bot that never asks for a secret is a bot users can be
 * told to distrust the moment anything does.
 *
 * Telegram retries any non-2xx, so this always returns 200 once the update has
 * been accepted; failures are logged, not bounced back into a retry loop.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MODEL = "claude-opus-5";
const MAX_TOKENS = 1200;

interface Update {
  message?: {
    chat?: { id?: number };
    from?: { id?: number; username?: string };
    text?: string;
  };
}

async function reply(question: string, userId: string | null, ctx: FaqCtx): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;

  if (key) {
    try {
      // Loaded from the LINKED user id, never from anything in the message —
      // so a crafted "I'm actually user X" can't reach another account.
      const account = userId ? await buildUserContext(userId) : "";

      const client = new Anthropic({ apiKey: key });
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: [
          {
            type: "text",
            text: `${assistantRules()}\n\n${ttipKnowledge()}`,
            cache_control: { type: "ephemeral" },
          },
          {
            type: "text",
            text: account
              ? `# This conversation is on Telegram, and the account is linked\n` +
                `You can see this user's account below and should answer about it directly.\n` +
                `You cannot perform actions here: no transfers, no swaps, no bill payments, no PIN entry. ` +
                `Telegram is read-only by design. When they want to DO something, tell them to open ` +
                `${COMPANY.domain}. Never ask for a PIN, password, BVN or OTP — you never need them.\n\n` +
                account
              : `# This conversation is on Telegram, and the account is NOT linked\n` +
                `You cannot see who this is. Never state a balance, a transaction status or a personal limit. ` +
                `If they ask about their own account, tell them to open ${COMPANY.domain} and connect this ` +
                `chat under Account → Telegram — one tap, and they never type anything secret into Telegram.`,
          },
        ],
        messages: [{ role: "user", content: question }],
      });

      if (res.stop_reason !== "refusal") {
        const text = res.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");
        const clean = cleanAssistantText(text).text;
        if (clean) return clean;
      }
    } catch (e) {
      // Fall through to the built-in answers rather than going silent.
      console.error("[telegram] model unavailable, using built-in answers", e);
    }
  }

  return answerFaq(question, ctx).text;
}

type FaqCtx = Parameters<typeof answerFaq>[1];

/** `/start <token>` — the deep link from the app. */
async function handleStart(chatId: number, arg: string, username?: string): Promise<string> {
  if (!arg) {
    const linked = await userForChat(chatId);
    return telegramWelcome(linked?.name);
  }

  const res = await redeemLinkToken(arg, chatId, username);
  if (res.ok) {
    return (
      `Connected ✅ — you're signed in as ${res.name}.\n\n` +
      `You can now ask me about your own account: your balance, your limits, your account number, ` +
      `or why a transfer is still pending.\n\n` +
      `Moving money stays in the app at ${COMPANY.domain}. /unlink disconnects this chat whenever you want.`
    );
  }

  switch (res.reason) {
    case "expired":
      return `That link has expired — they only last a few minutes for safety. Open ${COMPANY.domain}, go to Account → Telegram and tap Connect for a fresh one.`;
    case "used":
      return `That link has already been used. Each one works once — grab a new one from Account → Telegram in the app.`;
    case "chat_taken":
      return `This Telegram account is already connected to a different ${COMPANY.product} account. Send /unlink here first, then try again.`;
    default:
      return `I couldn't read that link. Open ${COMPANY.domain} → Account → Telegram and tap Connect to get a working one.`;
  }
}

export async function POST(req: Request) {
  if (!telegramEnabled()) return NextResponse.json({ ok: true });

  // Reject anything that isn't Telegram. Without this, the URL alone is enough
  // for anyone to drive the bot.
  const secret = telegramWebhookSecret();
  if (secret && req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ ok: true });
  }

  let update: Update;
  try {
    update = (await req.json()) as Update;
  } catch {
    return NextResponse.json({ ok: true });
  }

  const chatId = update.message?.chat?.id;
  const text = (update.message?.text ?? "").trim();
  if (!chatId || !text) return NextResponse.json({ ok: true });

  try {
    // Per-chat throttle: the model costs money and a bot is trivially spammable.
    rateLimit(`telegram:${chatId}`, { limit: 12, windowMs: 60_000 });
  } catch {
    await sendMessage(chatId, "You're going a bit fast — give me a minute and try again.");
    return NextResponse.json({ ok: true });
  }

  const [command, ...rest] = text.split(/\s+/);
  const arg = rest.join(" ").trim();

  try {
    if (command === "/start") {
      await sendMessage(chatId, await handleStart(chatId, arg, update.message?.from?.username));
      return NextResponse.json({ ok: true });
    }

    if (command === "/unlink") {
      const done = await unlinkChat(chatId);
      await sendMessage(
        chatId,
        done
          ? `Disconnected. I can't see your account from this chat any more — I'll still answer questions about ${COMPANY.product}.`
          : `This chat isn't connected to a ${COMPANY.product} account, so there's nothing to disconnect.`,
      );
      return NextResponse.json({ ok: true });
    }

    const linked = await userForChat(chatId);

    if (command === "/help") {
      await sendMessage(chatId, telegramWelcome(linked?.name));
      return NextResponse.json({ ok: true });
    }

    // "Who am I here?" — worth its own answer, because the whole point of the
    // link is that the answer stops being "I don't know".
    if (command === "/account" || command === "/me") {
      await sendMessage(
        chatId,
        linked
          ? `You're connected as ${linked.name} (@${linked.username}).`
          : `This chat isn't connected yet. Open ${COMPANY.domain} → Account → Telegram and tap Connect.`,
      );
      return NextResponse.json({ ok: true });
    }

    await sendTyping(chatId);

    const ctx: FaqCtx = linked
      ? {
          name: linked.name,
          tier: linked.kycTier,
          kycStatus: linked.kycStatus,
          nairaAccount: linked.nairaAccount,
          nairaBank: linked.nairaBank,
          bankAliases: bankAliases(linked.nairaBank),
        }
      : {};

    await sendMessage(chatId, await reply(text.replace(/^\/\w+\s*/, ""), linked?.id ?? null, ctx));
  } catch (e) {
    console.error("[telegram] reply failed", e);
    await sendMessage(chatId, "Something went wrong on my side — try again in a moment.");
  }

  return NextResponse.json({ ok: true });
}
