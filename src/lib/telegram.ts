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

/**
 * The bot's @username, needed to build a t.me deep link.
 *
 * Read from getMe rather than made another environment variable to set: the
 * token already identifies the bot, and a hand-typed username that doesn't
 * match it produces a link to the wrong bot — or to nothing. Cached because it
 * never changes within a deployment.
 */
let botUsernameCache: string | null = null;

export async function botUsername(): Promise<string | null> {
  if (botUsernameCache) return botUsernameCache;
  const override = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "");
  if (override) return (botUsernameCache = override);

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`${API}/bot${token}/getMe`, { cache: "no-store" });
    const json = (await res.json()) as { ok?: boolean; result?: { username?: string } };
    if (json.ok && json.result?.username) return (botUsernameCache = json.result.username);
  } catch (e) {
    console.error("[telegram] getMe failed", e);
  }
  return null;
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

/**
 * The greeting, which depends entirely on whether we know who this is.
 *
 * Unlinked, the honest thing is to say so and hand them the one action that
 * fixes it. Linked, greeting them by name is what makes the bot feel like their
 * account rather than a leaflet.
 */
export function telegramWelcome(name?: string | null): string {
  const safety = `Never share your PIN, password, BVN or OTP with anyone, including me — I will never ask for them here.`;

  if (name) {
    return (
      `Hi ${name.split(" ")[0]} — Ada here, and I can see your ${COMPANY.product} account.\n\n` +
      `Ask me things like "what's my balance", "why is my transfer pending", "what's my limit", ` +
      `"what's my account number" or anything about fees, KYC, bills, referrals and cashback.\n\n` +
      `Moving money still happens in the app at ${COMPANY.domain} — that's deliberate, so nobody who ` +
      `picks up your phone can spend from a chat window.\n\n` +
      `/unlink disconnects this chat from your account at any time.\n\n${safety}`
    );
  }

  return (
    `Hi, I'm Ada — the ${COMPANY.product} assistant.\n\n` +
    `Ask me anything about ${COMPANY.product}: fees, limits, KYC, deposits, payouts, bills, referrals or cashback.\n\n` +
    `To ask about YOUR account — your balance, a transfer, your limits — connect this chat: open ${COMPANY.domain}, ` +
    `go to Account → Telegram and tap Connect. It takes one tap and you never type anything secret here.\n\n${safety}`
  );
}
