import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { repairDeposit, scanMislabelledDeposits } from "@/lib/settlement/deposit-repair";

/**
 * Admin: find and correct deposits mis-credited by the origin/settlement
 * asset mix-up — the bug that credited 0.4 SOL as 0.4 USDC.
 *
 * GET  lists affected deposits. Read-only.
 * POST corrects one, by settlementId. Real balance moves, so it takes an
 *      explicit id — there is no "fix everything" call.
 *
 * 404s for non-admins, like the other admin routes.
 */

export const dynamic = "force-dynamic";

async function adminEmail(userId: string): Promise<string | null> {
  const raw = process.env.ADMIN_EMAILS ?? process.env.ADMIN_MAILS ?? "";
  const admins = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!admins.length) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user || !admins.includes(user.email.toLowerCase())) return null;
  return user.email;
}

export async function GET(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await adminEmail(userId))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const email = new URL(req.url).searchParams.get("email") ?? undefined;

  try {
    const findings = await scanMislabelledDeposits({ email: email || undefined });
    return NextResponse.json({
      findings,
      counts: {
        total: findings.length,
        repairable: findings.filter((f) => f.verdict === "MIS_CREDITED" && !f.alreadyRepaired).length,
        manual: findings.filter((f) => f.verdict === "NEEDS_MANUAL" && !f.alreadyRepaired).length,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const actor = await adminEmail(userId);
  if (!actor) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: { settlementId?: string; asset?: string; amount?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const settlementId = String(body.settlementId ?? "").trim();
  if (!settlementId) {
    return NextResponse.json({ error: "settlementId is required." }, { status: 400 });
  }

  // A manual correction must carry BOTH the asset and a positive amount —
  // half of a pair is what caused this bug in the first place.
  let manual: { asset: string; amount: number } | undefined;
  if (body.asset !== undefined || body.amount !== undefined) {
    const asset = String(body.asset ?? "").trim().toUpperCase();
    const amount = Number(body.amount);
    if (!asset || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { error: "A manual correction needs both a settled asset and a positive amount." },
        { status: 400 },
      );
    }
    manual = { asset, amount };
  }

  try {
    const result = await repairDeposit(settlementId, actor, manual);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json(result);
  } catch (e) {
    console.error("[admin] deposit repair failed", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
