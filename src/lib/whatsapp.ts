import "server-only";
import crypto from "crypto";

/**
 * WhatsApp, via Meta's Cloud API.
 *
 * The same Ada, on the app most Nigerians already have open. Three differences
 * from Telegram shape everything downstream, and none of them is cosmetic:
 *
 *  1. WE CANNOT DELETE A USER'S MESSAGE. Telegram's bot API can, which is the
 *     only reason asking for a PIN there is defensible. Here a PIN would sit in
 *     their chat history for good, readable by anyone who opens WhatsApp on
 *     that phone — so transfers are confirmed with a single-use code instead,
 *     the same sheet the SMS surface uses.
 *
 *  2. IDENTITY COMES FROM META. The `wa_id` is a phone number Meta has already
 *     verified. If that number is a phone the user linked in the app, we know
 *     who they are without a second dance.
 *
 *  3. THE 24-HOUR WINDOW. Free-form replies are only allowed within 24 hours of
 *     the user's last message. Outside it, only pre-approved templates go
 *     through — which is why a proactive "your scheduled transfer sent" cannot
 *     simply be sent here, and quietly failing to send it would be worse than
 *     not offering it.
 */

export interface WhatsAppConfig {
  token: string;
  phoneNumberId: string;
  appSecret?: string;
  verifyToken: string;
  apiVersion: string;
}

export function whatsappConfig(): WhatsAppConfig | null {
  const token = process.env.WHATSAPP_TOKEN?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN?.trim();
  if (!token || !phoneNumberId || !verifyToken) return null;
  return {
    token,
    phoneNumberId,
    appSecret: process.env.WHATSAPP_APP_SECRET?.trim() || undefined,
    verifyToken,
    apiVersion: process.env.WHATSAPP_API_VERSION?.trim() || "v21.0",
  };
}

export function whatsappEnabled(): boolean {
  return !!whatsappConfig();
}

/**
 * Is this really from Meta?
 *
 * The webhook URL is public and it moves money, so a request that merely looks
 * right is not enough. Meta signs every delivery with the app secret; when one
 * is configured we check it, in constant time, and drop anything that fails.
 *
 * Returns true when no app secret is set — so a deployment can be brought up
 * before the secret is in place — but that is a gap, and the webhook logs it
 * loudly rather than letting it pass quietly for months.
 */
export function verifyWhatsAppSignature(rawBody: string, header: string | null): boolean {
  const cfg = whatsappConfig();
  if (!cfg?.appSecret) {
    console.error("[whatsapp] WHATSAPP_APP_SECRET is not set — inbound messages are NOT being verified.");
    return true;
  }
  if (!header?.startsWith("sha256=")) return false;

  const expected = crypto.createHmac("sha256", cfg.appSecret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(header.slice("sha256=".length));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Send a message. Never throws — a reply that fails must not unwind a transfer
 * that already happened.
 *
 * WhatsApp uses a single asterisk for bold, not two. Ada writes markdown, so it
 * is converted here rather than teaching her a second dialect: the same answer
 * has to read correctly on both surfaces.
 */
export async function sendWhatsApp(to: string, text: string): Promise<boolean> {
  const cfg = whatsappConfig();
  if (!cfg) {
    console.error(`[whatsapp] not configured — would have sent to ${to}: ${text.slice(0, 80)}`);
    return false;
  }

  try {
    const res = await fetch(`https://graph.facebook.com/${cfg.apiVersion}/${cfg.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: toWhatsAppMarkup(text).slice(0, 4096) },
      }),
    });
    if (!res.ok) {
      console.error(`[whatsapp] send ${res.status}: ${await res.text().catch(() => "")}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[whatsapp] send threw", e);
    return false;
  }
}

/** `**bold**` → `*bold*`, and `__x__`/`*x*` → `_x_`, which is what WhatsApp renders. */
export function toWhatsAppMarkup(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/gs, "*$1*")
    .replace(/(^|[^*_])_([^_\n]+)_(?!_)/g, "$1_$2_")
    .replace(/`{3}[\s\S]*?`{3}/g, (m) => m.replace(/`{3}/g, ""))
    .replace(/^#{1,6}\s*/gm, "");
}

/** Mark a message read, so the user sees the ticks while Ada thinks. */
export async function markWhatsAppRead(messageId: string): Promise<void> {
  const cfg = whatsappConfig();
  if (!cfg) return;
  try {
    await fetch(`https://graph.facebook.com/${cfg.apiVersion}/${cfg.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId }),
    });
  } catch {
    /* cosmetic; never worth failing a message over */
  }
}

/** The number people message us on, for the app's "Chat on WhatsApp" link. */
export function whatsappLink(text?: string): string | null {
  const number = process.env.WHATSAPP_BUSINESS_NUMBER?.trim().replace(/[^\d]/g, "");
  if (!number) return null;
  return `https://wa.me/${number}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
