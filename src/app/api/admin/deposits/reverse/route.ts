import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { suspectDeposits, reverseDeposits, reverseDeposit } from "@/lib/settlement/deposit-reverse";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Reversing mis-credited deposits.
 *
 *   GET                       → what WOULD be reversed. Changes nothing.
 *   POST { confirm: true }    → reverse everything that GET just listed.
 *   POST { externalIds: [..] } → reverse exactly these.
 *
 * The preview is not politeness, it is the safety mechanism. A one-tap "reverse
 * everything" that nobody has read is how a legitimate deposit gets taken off
 * someone who actually made it, and that is a worse day than the bug being
 * fixed. So the list comes first, and confirming acts on that same list.
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

async function guard(): Promise<string | null> {
  const userId = await getUserId();
  if (!userId) return null;
  return (await isAdmin(userId)) ? userId : null;
}

export async function GET() {
  if (!(await guard())) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const suspects = await suspectDeposits(200);
  return NextResponse.json({
    count: suspects.length,
    totalByAsset: suspects.reduce<Record<string, number>>((acc, s) => {
      acc[s.symbol] = (acc[s.symbol] ?? 0) + s.amount;
      return acc;
    }, {}),
    deposits: suspects,
    howToApply: "POST to this URL with { \"confirm\": true } to reverse all of the above.",
  });
}

export async function POST(req: Request) {
  if (!(await guard())) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    confirm?: boolean;
    externalIds?: string[];
    note?: string;
  };

  // An explicit list wins — it's the most deliberate thing the caller can do.
  if (Array.isArray(body.externalIds) && body.externalIds.length) {
    const results = await reverseDeposits(body.externalIds, body.note);
    return NextResponse.json({ reversed: results.filter((r) => r.reversed).length, results });
  }

  if (!body.confirm) {
    return NextResponse.json(
      { error: "Nothing done. GET this URL to see what would be reversed, then POST { confirm: true }." },
      { status: 400 },
    );
  }

  // Re-listed at the moment of action rather than trusting a list from an
  // earlier request — the set must be the live one, not a stale snapshot.
  const suspects = await suspectDeposits(200);
  const results = [];
  for (const s of suspects) results.push(await reverseDeposit(s.externalId, body.note ?? "raw base units credited"));

  return NextResponse.json({
    considered: suspects.length,
    reversed: results.filter((r) => r.reversed).length,
    // Money that was already spent before the reversal — a real loss, and the
    // only part a reversal cannot fix.
    shortfalls: results.filter((r) => (r.shortfall ?? 0) > 0),
    results,
  });
}
