import "server-only";
import { COMPANY } from "./company";
import { toTelegramHtml, toPlainText } from "./telegram-format";

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

async function call(method: string, body: unknown): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  try {
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`[telegram] ${method} failed`, res.status, (await res.text()).slice(0, 300));
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[telegram] ${method} threw`, e);
    return false;
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

/**
 * Send a reply, formatted.
 *
 * Ada writes Markdown. Telegram renders none of it without a parse_mode, so
 * `**Tier 2**` used to arrive with the asterisks showing and the whole chat
 * looked cheap. toTelegramHtml escapes the text before adding any tags, so the
 * markup can only ever be well-formed (see lib/telegram-format.ts).
 *
 * If Telegram still refuses it, the message is re-sent as plain text. A styling
 * bug must never turn into silence — silence is the one failure a support bot
 * cannot have.
 */
export async function sendMessage(chatId: number | string, text: string): Promise<void> {
  // Telegram rejects messages over 4096 characters. Cut the SOURCE, not the
  // HTML, so the limit can't slice a tag in half.
  const source = (text ?? "").slice(0, 3800);

  const sent = await call("sendMessage", {
    chat_id: chatId,
    text: toTelegramHtml(source),
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
  if (sent) return;

  await call("sendMessage", {
    chat_id: chatId,
    text: toPlainText(source),
    disable_web_page_preview: true,
  });
}

/**
 * Delete a message from the chat.
 *
 * This is what makes typing a PIN into Telegram tolerable: the moment we've
 * read it, the message is removed from the conversation so it isn't sitting in
 * the user's history — or on the lock screen of whoever picks the phone up next.
 * Bots may delete incoming messages in private chats, which is exactly our case.
 *
 * Returns false if Telegram refused, so the caller can tell the user to delete
 * it by hand rather than leave them believing it's gone.
 */
export async function deleteMessage(chatId: number | string, messageId: number): Promise<boolean> {
  return call("deleteMessage", { chat_id: chatId, message_id: messageId });
}

/**
 * Download a file the user sent (a photo, a voice note).
 *
 * Two hops, because that's how Telegram works: getFile turns a file_id into a
 * path, then the path is fetched from the file endpoint. Capped, because an
 * attachment is the one thing in a chat whose size someone else chooses.
 */
export async function downloadFile(
  fileId: string,
  maxBytes = 6 * 1024 * 1024,
): Promise<{ buffer: Buffer; mime: string | null } | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  try {
    const meta = await fetch(`${API}/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
    const json = (await meta.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: { file_path?: string; file_size?: number };
    };
    const path = json.result?.file_path;
    if (!json.ok || !path) return null;
    if ((json.result?.file_size ?? 0) > maxBytes) return null;

    const res = await fetch(`${API}/file/bot${token}/${path}`);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) return null;
    return { buffer: buf, mime: res.headers.get("content-type") };
  } catch (e) {
    console.error("[telegram] file download failed", e);
    return null;
  }
}

/**
 * Send an image into the chat.
 *
 * multipart/form-data rather than a URL, because the receipt is generated in
 * memory for one user and should never need a public address to be fetched from.
 */
export async function sendPhoto(
  chatId: number | string,
  png: Buffer,
  caption?: string,
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  try {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("photo", new Blob([new Uint8Array(png)], { type: "image/png" }), "receipt.png");
    if (caption) {
      form.append("caption", toTelegramHtml(caption.slice(0, 900)));
      form.append("parse_mode", "HTML");
    }
    const res = await fetch(`${API}/bot${token}/sendPhoto`, { method: "POST", body: form });
    if (!res.ok) {
      console.error("[telegram] sendPhoto failed", res.status, (await res.text()).slice(0, 300));
      return false;
    }
    return true;
  } catch (e) {
    console.error("[telegram] sendPhoto threw", e);
    return false;
  }
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
/**
 * The name to greet someone by.
 *
 * Skips a one- or two-letter first word, because that's a title: "Mr
 * Jenerouszy" was being greeted as "Hi Mr", which reads worse than no name.
 * Falls back to the second word, then to nothing.
 */
function firstName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  const pick = parts.find((p) => p.replace(/\W/g, "").length >= 3);
  return pick ?? parts[0] ?? "";
}

export function telegramWelcome(name?: string | null): string {
  const safety = `Never share your PIN, password, BVN or OTP with anyone, including me — I will never ask for them here.`;

  if (name) {
    return (
      `Hi ${firstName(name)} — Ada here, and I can see your ${COMPANY.product} account.\n\n` +
      `**Send money — three ways**\n` +
      `• Type it: *"send ₦5,000 to 9077984753 Opay"*\n` +
      `• Photograph the account and add *"send ₦5,000 to this"*\n` +
      `• Say it: hold the mic and speak\n\n` +
      `I confirm the account name with the bank, then you reply with your PIN — and I delete your ` +
      `PIN from this chat the second I read it.\n\n` +
      `**Ask me anything**\n` +
      `"What's my balance", "why is my transfer pending", "what's my limit", "what's my account number", ` +
      `or anything about fees, KYC, bills, referrals and cashback.\n\n` +
      `/cancel drops a pending transfer · /unlink disconnects this chat\n\n${safety}`
    );
  }

  return (
    `Hi, I'm Ada — the ${COMPANY.product} assistant.\n\n` +
    `Ask me anything about ${COMPANY.product}: fees, limits, KYC, deposits, payouts, bills, referrals or cashback.\n\n` +
    `To ask about YOUR account — your balance, a transfer, your limits — connect this chat: open ${COMPANY.domain}, ` +
    `go to Account → Telegram and tap Connect. It takes one tap and you never type anything secret here.\n\n${safety}`
  );
}
