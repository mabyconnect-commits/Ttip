/*
 * Point your Telegram bot at Ttip.
 *
 *   TELEGRAM_BOT_TOKEN=123:abc \
 *   TELEGRAM_WEBHOOK_SECRET=some-long-random-string \
 *   APP_URL=https://www.ttip.site \
 *   node scripts/telegram-setup.mjs
 *
 * Run it once after deploying, and again whenever the URL or secret changes.
 * `node scripts/telegram-setup.mjs --status` just reports the current state.
 */

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET || "";
const appUrl = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");

if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is required (get it from @BotFather).");
  process.exit(1);
}

const api = (m, body) =>
  fetch(`https://api.telegram.org/bot${token}/${m}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  }).then((r) => r.json());

const me = await api("getMe");
if (!me.ok) {
  console.error("Bad token:", me.description);
  process.exit(1);
}
console.log(`Bot: @${me.result.username} (${me.result.first_name})`);

if (process.argv.includes("--status")) {
  const info = await api("getWebhookInfo");
  console.log(JSON.stringify(info.result, null, 2));
  process.exit(0);
}

if (!appUrl) {
  console.error("APP_URL is required, e.g. APP_URL=https://www.ttip.site");
  process.exit(1);
}
if (!secret) {
  // The webhook URL is guessable; the secret is what proves an update is real.
  console.error("TELEGRAM_WEBHOOK_SECRET is required — without it anyone can drive your bot.");
  process.exit(1);
}

const url = `${appUrl}/api/telegram/webhook`;
const set = await api("setWebhook", {
  url,
  secret_token: secret,
  // Only messages. Nothing else is handled, so don't pay for the delivery.
  allowed_updates: ["message"],
  drop_pending_updates: true,
});

if (!set.ok) {
  console.error("setWebhook failed:", set.description);
  process.exit(1);
}

console.log(`Webhook set → ${url}`);
const info = await api("getWebhookInfo");
console.log(`Pending: ${info.result.pending_update_count}` + (info.result.last_error_message ? ` · last error: ${info.result.last_error_message}` : ""));
console.log("\nSend /start to the bot to test.");
