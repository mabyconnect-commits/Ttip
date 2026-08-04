import { z } from "zod";
import { prisma } from "@/lib/db";
import { handler, ok } from "@/lib/api";
import { rateLimit, clientIp } from "@/lib/rate-limit";

/**
 * Is this username free? Checked while the user types, before they submit.
 *
 * Picking a handle used to mean filling in the whole form, submitting, and
 * being told "that username is taken" — then guessing again. The username is
 * someone's tip link and how people Ttip them, so choosing it should be the
 * deliberate step it looks like.
 *
 * Usernames are already public (every one resolves at /u/<name>), so this
 * exposes nothing new. It is still rate limited, because a fast endpoint that
 * confirms which handles exist is worth scraping.
 */

export const dynamic = "force-dynamic";

const schema = z
  .string()
  .min(3, "At least 3 characters")
  .max(20, "20 characters max")
  .regex(/^[a-zA-Z0-9_]+$/, "Letters, numbers and _ only");

/** Alternatives close to what they wanted, only offered if actually free. */
function candidates(base: string): string[] {
  const trimmed = base.slice(0, 16);
  const out = [`${trimmed}_`, `${trimmed}1`, `${trimmed}${new Date().getFullYear() % 100}`];
  for (let i = 0; i < 3; i++) out.push(`${trimmed}${Math.floor(Math.random() * 900) + 100}`);
  return Array.from(new Set(out)).filter((u) => u.length <= 20);
}

export async function GET(req: Request) {
  return handler(async () => {
    rateLimit(`username-check:${clientIp(req)}`, { limit: 60, windowMs: 60_000 });

    const raw = (new URL(req.url).searchParams.get("u") ?? "").trim();
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      return ok({
        username: raw,
        valid: false,
        available: false,
        reason: parsed.error.issues[0]?.message ?? "Invalid username",
        suggestions: [],
      });
    }

    // Stored lowercase, so the check has to be too — otherwise "Kola" would
    // look free right up until signup rejected it against "kola".
    const username = parsed.data.toLowerCase();
    const taken = await prisma.user.findUnique({ where: { username }, select: { id: true } });

    if (!taken) return ok({ username, valid: true, available: true, suggestions: [] });

    const options = candidates(username);
    const used = await prisma.user.findMany({
      where: { username: { in: options } },
      select: { username: true },
    });
    const usedSet = new Set(used.map((u) => u.username));

    return ok({
      username,
      valid: true,
      available: false,
      reason: "That username is taken",
      suggestions: options.filter((u) => !usedSet.has(u)).slice(0, 3),
    });
  });
}
