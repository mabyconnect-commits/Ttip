import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { sendMessage, sendTyping, telegramEnabled, telegramWebhookSecret, TELEGRAM_WELCOME } from "@/lib/telegram";
import { answerFaq } from "@/lib/assistant/faq";
import { assistantRules, ttipKnowledge } from "@/lib/assistant/knowledge";
import { cleanAssistantText } from "@/lib/assistant/sanitize";
import { rateLimit } from "@/lib/rate-limit";

/**
 * The Ttip Telegram bot.
 *
 * Same brain as Ada in the app — the model when a key is configured, the
 * built-in answers when it isn't — but deliberately WITHOUT account context.
 *
 * A Telegram chat id proves nothing about who someone is. Anyone can message
 * the bot. So it answers product questions only and never touches a balance, a
 * transaction or a limit; for those it sends people into the app, where they're
 * actually signed in. That's also why there is no "link your account" flow here
 * — it would be a phishing surface with no benefit the app doesn't already give.
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
    from?: { id?: number };
    text?: string;
  };
}

async function reply(question: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;

  if (key) {
    try {
      const client = new Anthropic({ apiKey: key });
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: [
          {
            type: "text",
            text:
              `${assistantRules()}\n\n${ttipKnowledge()}\n\n` +
              `# This conversation is on Telegram\n` +
              `You cannot see who this is and have no access to their account. Never state a balance, ` +
              `a transaction status or a personal limit. For anything account-specific, tell them to open ` +
              `the app and use the chat there, where you can see their account.`,
            cache_control: { type: "ephemeral" },
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

  // No account context on purpose — see the note at the top of this file.
  return answerFaq(question).text;
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

  if (text === "/start" || text === "/help") {
    await sendMessage(chatId, TELEGRAM_WELCOME);
    return NextResponse.json({ ok: true });
  }

  try {
    await sendTyping(chatId);
    await sendMessage(chatId, await reply(text.replace(/^\/\w+\s*/, "")));
  } catch (e) {
    console.error("[telegram] reply failed", e);
    await sendMessage(chatId, "Something went wrong on my side — try again in a moment.");
  }

  return NextResponse.json({ ok: true });
}
