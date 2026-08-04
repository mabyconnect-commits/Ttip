import "server-only";
import { COMPANY } from "./company";

/**
 * Telegram Bot API client — just the two calls the bot needs.
 *
 * Kept tiny and dependency-free rather than pulling in a bot framework: the bot
 * receives a webhook, answers, and that's it. No polling loop, no state.
 */

// Overridable only so the webhook can be exercised against a local stub in
// tests; unset everywhere else.
const API = process.env.TELEGRAM_API_BASE || "https://api.telegram.org";

export function telegramEnabled(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

/**
 * The shared secret Telegram echoes back in X-Telegram-Bot-Api-Secret-Token.
 * Without it, anyone who guesses the webhook URL can post fake updates.
 */
export function telegramWebhookSecret(): string | null {
  return process.env.TELEGRAM_WEBHOOK_SECRET || null;
}

async function call(method: string, body: unknown): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`[telegram] ${method} failed`, res.status, (await res.text()).slice(0, 300));
    }
  } catch (e) {
    console.error(`[telegram] ${method} threw`, e);
  }
}

/** Send a reply. Plain text — no parse_mode, so nothing a user types can break it. */
export async function sendMessage(chatId: number | string, text: string): Promise<void> {
  // Telegram rejects messages over 4096 characters.
  await call("sendMessage", {
    chat_id: chatId,
    text: text.slice(0, 4000),
    disable_web_page_preview: true,
  });
}

/** The "typing…" indicator, so a slow model answer doesn't look like nothing happened. */
export async function sendTyping(chatId: number | string): Promise<void> {
  await call("sendChatAction", { chat_id: chatId, action: "typing" });
}

export const TELEGRAM_WELCOME =
  `Hi, I'm Ada — the ${COMPANY.product} assistant.\n\n` +
  `Ask me anything about ${COMPANY.product}: fees, limits, KYC, deposits, payouts, bills, referrals or cashback.\n\n` +
  `I can't see your account here — Telegram has no way to prove who you are — so for anything about your own balance, ` +
  `a specific transaction or your limits, open the app at ${COMPANY.domain} and use the chat inside it, where I can.\n\n` +
  `Never share your PIN, password, BVN or OTP with anyone, including me.`;
