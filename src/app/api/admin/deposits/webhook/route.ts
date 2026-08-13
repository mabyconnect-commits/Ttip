import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { configureWebhook, readWebhookConfig } from "@/lib/settlement/dextopus";
import { COMPANY } from "@/lib/company";

export const dynamic = "force-dynamic";

/**
 * Tell Dextopus where to deliver deposit events.
 *
 * `configureWebhook` was written and then never called from anywhere, so unless
 * the URL was registered by hand in their dashboard, Dextopus had nowhere to
 * send anything. Deposits settled into treasury exactly as they should and the
 * app was never told — no settlement row, no transaction, nothing in any log,
 * because no request was ever made. Signature handling and amount parsing are
 * both irrelevant when the call never arrives.
 *
 *   GET  → what they currently have registered, and the URL we would set
 *   POST → register it
 */

async function isAdmin(userId: string): Promise<boolean> {
  const admins = (process.env.ADMIN_EMAILS ?? process.env.ADMIN_MAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!admins.length) return false;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return !!user?.email && admins.includes(user.email.toLowerCase());
}

/** The URL Dextopus should call. Derived from the request so it is never stale. */
function webhookUrl(req: Request): string {
  const explicit = process.env.DEPOSIT_WEBHOOK_URL?.trim();
  if (explicit) return explicit;
  const origin = process.env.NEXT_PUBLIC_APP_URL?.trim() || `https://${COMPANY.domain}`;
  try {
    return new URL("/api/webhooks/deposit", origin).toString();
  } catch {
    return new URL("/api/webhooks/deposit", new URL(req.url).origin).toString();
  }
}

export async function GET(req: Request) {
  const me = await getUserId();
  if (!me || !(await isAdmin(me))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    wouldRegister: webhookUrl(req),
    currentlyRegistered: await readWebhookConfig(),
  });
}

export async function POST(req: Request) {
  const me = await getUserId();
  if (!me || !(await isAdmin(me))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const url = webhookUrl(req);
  const result = await configureWebhook(url);
  console.error("[deposit] webhook registration attempted", { url, ...result });
  return NextResponse.json({ url, ...result });
}
