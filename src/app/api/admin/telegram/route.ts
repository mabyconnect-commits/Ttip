import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { baseUrl } from "@/lib/url";

/**
 * Why isn't the Telegram bot replying?
 *
 * A bot that goes silent gives you nothing to work with: the webhook returns
 * 200 whether it worked, the token is missing, or the secret didn't match —
 * because Telegram retries anything else, and a retry storm is worse than
 * silence. So this asks Telegram itself what it sees.
 *
 * GET  → the full picture, including Telegram's own last_error_message, which
 *        usually names the problem outright.
 * POST → re-point the webhook at this deployment using the secret from THIS
 *        environment, so the two can't disagree. A mismatch between the secret
 *        in the environment and the one Telegram was given is the most common
 *        cause of a silent bot, and setting both from one place ends it.
 */

export const dynamic = "force-dynamic";

async function isAdmin(userId: string): Promise<boolean> {
  const raw = process.env.ADMIN_EMAILS ?? process.env.ADMIN_MAILS ?? "";
  const admins = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!admins.length) return false;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return !!user && admins.includes(user.email.toLowerCase());
}

async function guard(): Promise<string | NextResponse> {
  const userId = await getUserId();
  if (!userId || !(await isAdmin(userId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return userId;
}

function expectedUrl(): string {
  return `${baseUrl().replace(/\/$/, "")}/api/telegram/webhook`;
}

async function tg(method: string, body?: unknown) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    return (await r.json()) as { ok: boolean; result?: any; description?: string };
  } catch (e) {
    return { ok: false, description: `Could not reach Telegram: ${(e as Error).message}` };
  }
}

export async function GET() {
  const g = await guard();
  if (typeof g !== "string") return g;

  const hasToken = !!process.env.TELEGRAM_BOT_TOKEN;
  const hasSecret = !!process.env.TELEGRAM_WEBHOOK_SECRET;
  const url = expectedUrl();

  const problems: string[] = [];
  if (!hasToken) {
    problems.push(
      "TELEGRAM_BOT_TOKEN is not set on this deployment. The webhook accepts updates and ignores them. " +
        "Add it in Vercel and REDEPLOY — new variables don't reach a running deployment.",
    );
  }
  if (!hasSecret) {
    problems.push(
      "TELEGRAM_WEBHOOK_SECRET is not set. The bot will still work, but anyone who finds the URL can drive it.",
    );
  }

  const me = hasToken ? await tg("getMe") : null;
  if (me && !me.ok) problems.push(`Telegram rejected the token: ${me.description}`);

  const info = hasToken ? await tg("getWebhookInfo") : null;
  const hook = info?.result;

  if (hook) {
    if (!hook.url) {
      problems.push(`No webhook is set. POST to this endpoint to point Telegram at ${url}.`);
    } else if (hook.url !== url) {
      problems.push(
        `Telegram is sending updates to ${hook.url}, but this deployment is ${url}. ` +
          (hook.url.replace("://", "://www.") === url
            ? "That's the apex domain — it 308-redirects to www, and Telegram does NOT follow redirects, so every update fails silently."
            : "POST to this endpoint to correct it."),
      );
    }
    if (hook.last_error_message) {
      problems.push(`Telegram's last delivery error: ${hook.last_error_message}`);
    }
    if (hook.pending_update_count > 0) {
      problems.push(`${hook.pending_update_count} update(s) queued and undelivered — deliveries are failing.`);
    }
    // Telegram only sends the kinds you subscribed to.
    if (Array.isArray(hook.allowed_updates) && hook.allowed_updates.length && !hook.allowed_updates.includes("message")) {
      problems.push(`Webhook isn't subscribed to "message" updates (it has: ${hook.allowed_updates.join(", ")}).`);
    }
  }

  return NextResponse.json({
    ready: problems.length === 0,
    bot: me?.result ? `@${me.result.username}` : null,
    env: { TELEGRAM_BOT_TOKEN: hasToken, TELEGRAM_WEBHOOK_SECRET: hasSecret },
    expectedWebhookUrl: url,
    telegramSees: hook
      ? {
          url: hook.url || null,
          pending: hook.pending_update_count,
          lastError: hook.last_error_message ?? null,
          lastErrorAt: hook.last_error_date ? new Date(hook.last_error_date * 1000).toISOString() : null,
          hasSecret: !!hook.has_custom_certificate || undefined,
          allowedUpdates: hook.allowed_updates ?? null,
        }
      : null,
    problems,
    fix: problems.length ? `POST to ${url.replace("/telegram/webhook", "/admin/telegram")} to set the webhook correctly.` : null,
  });
}

/** Point Telegram at this deployment, with this deployment's secret. */
export async function POST() {
  const g = await guard();
  if (typeof g !== "string") return g;

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return NextResponse.json(
      { ok: false, error: "TELEGRAM_BOT_TOKEN is not set on this deployment. Add it in Vercel and redeploy first." },
      { status: 400 },
    );
  }

  const url = expectedUrl();
  const res = await tg("setWebhook", {
    url,
    // Taken from THIS environment, so the two can never disagree.
    secret_token: process.env.TELEGRAM_WEBHOOK_SECRET || undefined,
    allowed_updates: ["message"],
    drop_pending_updates: true,
  });

  if (!res?.ok) {
    return NextResponse.json({ ok: false, error: res?.description ?? "setWebhook failed" }, { status: 400 });
  }

  const info = await tg("getWebhookInfo");
  return NextResponse.json({
    ok: true,
    url,
    secretSet: !!process.env.TELEGRAM_WEBHOOK_SECRET,
    telegramSees: info?.result?.url ?? null,
    next: "Send /start to the bot. If it still doesn't reply, GET this endpoint again — Telegram will now report the delivery error.",
  });
}
