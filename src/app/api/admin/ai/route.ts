import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * "Ada isn't answering" — this says why, in one request.
 *
 * When the model can't be reached, both surfaces fall back to the built-in
 * answers and look merely dim rather than broken: the app says "I'm not sure
 * about that one", the bot answers from the FAQ. The actual reason is in the
 * server logs, which is exactly where nobody can see it at 2am.
 *
 * So this makes the real call and reports the real error — an expired card, a
 * revoked key and a rate limit are three different problems with three
 * different fixes, and guessing between them wastes a night.
 *
 * Operator-only, and it returns no secret: the key is described (present, how
 * it starts, how long), never echoed.
 */

async function isAdmin(userId: string): Promise<boolean> {
  const admins = (process.env.ADMIN_EMAILS ?? process.env.ADMIN_MAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!admins.length) return process.env.DEMO_MODE === "true";
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return !!user && admins.includes(user.email.toLowerCase());
}

export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  if (!(await isAdmin(userId))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const key = process.env.ANTHROPIC_API_KEY;
  const model = "claude-opus-5";

  const keyInfo = key
    ? { present: true, length: key.length, startsWith: key.slice(0, 7), endsWith: key.slice(-4) }
    : { present: false };

  if (!key) {
    return NextResponse.json({
      ok: false,
      key: keyInfo,
      diagnosis:
        "ANTHROPIC_API_KEY is not set on this deployment. Ada answers from the built-in FAQ until it is.",
    });
  }

  const started = Date.now();
  try {
    const client = new Anthropic({ apiKey: key, maxRetries: 0 });
    const res = await client.messages.create({
      model,
      max_tokens: 8,
      messages: [{ role: "user", content: "Reply with the single word: ok" }],
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    return NextResponse.json({
      ok: true,
      key: keyInfo,
      model,
      ms: Date.now() - started,
      replied: text,
      usage: res.usage,
      diagnosis: "The model is reachable. If Ada is still falling back, it's a timeout on the longer call — check the logs for '[assistant] model unavailable'.",
    });
  } catch (e: unknown) {
    const err = e as { status?: number; name?: string; message?: string; error?: { error?: { type?: string; message?: string } } };
    const status = err?.status;
    const providerMessage = err?.error?.error?.message ?? err?.message ?? String(e);

    // The four that actually happen, told apart by what you'd DO about each.
    const diagnosis =
      status === 401
        ? "The key is rejected. It's wrong, revoked, or from a different org — issue a new one and set ANTHROPIC_API_KEY."
        : status === 400 && /credit|balance/i.test(providerMessage)
          ? "The account has no credit. Paying the invoice isn't always enough — check the workspace's credit balance and any spend limit."
          : status === 429
            ? "Rate limited. Ada will recover on her own; if it persists, the workspace's rate limits are too low for this traffic."
            : status === 404
              ? `The model "${model}" isn't available to this key — check the workspace's model access.`
              : status && status >= 500
                ? "Anthropic returned a server error. Nothing to fix here; retry."
                : "The call failed before a status came back — usually the network or a timeout from this deployment.";

    return NextResponse.json({
      ok: false,
      key: keyInfo,
      model,
      ms: Date.now() - started,
      status: status ?? null,
      providerMessage,
      diagnosis,
    });
  }
}
