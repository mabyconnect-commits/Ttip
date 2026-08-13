import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { configureWebhook, readWebhookConfig } from "@/lib/settlement/dextopus";
import crypto from "crypto";
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

  const body = (await req.json().catch(() => ({}))) as { test?: boolean };
  const url = webhookUrl(req);

  // Prove delivery works, rather than sending a real deposit and hoping.
  if (body.test) return NextResponse.json(await selfTest(url));

  const result = await configureWebhook(url);
  console.error("[deposit] webhook registration attempted", { url, ...result });
  return NextResponse.json({ url, ...result });
}

/**
 * Send ourselves a properly signed webhook and report exactly what happened.
 *
 * This is the difference between "we think deposits work" and knowing. It walks
 * the whole path a real Dextopus call takes — the registered URL, the signature
 * header, the raw body — and reports the status our own route returned.
 *
 * Two things it is careful about:
 *
 *  1. NOTHING IS CREDITED. The payload carries a PENDING status and an
 *     obviously fake reference, so creditDeposit stops at "not yet confirmed"
 *     and writes nothing. A test that moved money would be worse than no test.
 *  2. REDIRECTS ARE NOT FOLLOWED. If the registered host redirects — the classic
 *     www vs bare-domain trap — a followed POST silently becomes a GET and
 *     "succeeds" against the health check, which would report a green light on
 *     a webhook that can never deliver. Manual redirect handling catches it.
 */
async function selfTest(url: string) {
  const secret = process.env.DEXTOPUS_WEBHOOK_SECRET?.trim();
  if (!secret) return { ok: false, stage: "config", detail: "DEXTOPUS_WEBHOOK_SECRET is not set." };

  const payload = JSON.stringify({
    event: "deposit.pending",
    data: {
      requestId: `selftest_${Date.now()}`,
      depositAddress: "ttip-self-test-address",
      settlementAsset: "USDC",
      settlementAmountFormatted: 0.01,
      originChainId: 792703809,
      status: "PENDING",
    },
  });
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");

  try {
    const res = await fetch(url, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/json", "X-Signature-SHA256": signature },
      body: payload,
    });

    if (res.status >= 300 && res.status < 400) {
      return {
        ok: false,
        stage: "redirect",
        status: res.status,
        redirectsTo: res.headers.get("location"),
        detail:
          `${url} redirects. A POST that gets redirected loses its body, so Dextopus ` +
          `can never deliver here. Register the address it redirects TO instead.`,
      };
    }

    const text = await res.text().catch(() => "");
    if (res.status === 401) {
      return { ok: false, stage: "signature", status: 401, detail: `Signature rejected: ${text.slice(0, 200)}` };
    }
    if (!res.ok) {
      return { ok: false, stage: "route", status: res.status, detail: text.slice(0, 300) };
    }
    return {
      ok: true,
      stage: "delivered",
      status: res.status,
      detail: text.slice(0, 300),
      note: "Signed webhook accepted end to end. Nothing was credited — the test payload is pending-only.",
    };
  } catch (e) {
    return { ok: false, stage: "network", detail: (e as Error).message };
  }
}
