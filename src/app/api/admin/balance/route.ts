import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { adjust, kindOf } from "@/lib/wallet";
import { CRYPTO_BY_SYMBOL, FIAT_BY_CODE } from "@/lib/constants";

/**
 * Admin balance adjustment — credit or debit a user's balance by hand, with an
 * audit trail. Built to make users whole after a mis-credit (e.g. a deposit that
 * landed as the wrong amount), and reversible only by another logged adjustment.
 *
 * Safety:
 *   - Admin-only (ADMIN_EMAILS), same gate as every other /api/admin route.
 *   - Idempotent: each adjustment carries a client `idempotencyKey`; the audit
 *     Settlement row's unique externalId makes a repeat a no-op, so a double tap
 *     can never apply twice.
 *   - Atomic: the balance change, the audit Settlement and the user-visible
 *     Transaction are written in one database transaction.
 *   - Overdraft-guarded: a debit that would drive the balance negative is refused.
 *   - Every change records WHO did it and WHY (reason is required).
 *
 * GET  /api/admin/balance?user=<email|@username|id>  → inspect balances first.
 * POST /api/admin/balance  { user, symbol, delta, reason, idempotencyKey }
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

/** Resolve a user by id, email, or @username (a single trimmed identifier). */
async function resolveUser(qRaw: string) {
  const q = qRaw.trim();
  if (!q) return null;
  const handle = q.replace(/^@/, "").toLowerCase();
  return prisma.user.findFirst({
    where: { OR: [{ id: q }, { email: q.toLowerCase() }, { username: handle }] },
    select: { id: true, email: true, username: true, name: true },
  });
}

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

export async function GET(req: Request) {
  const me = await getUserId();
  if (!me || !(await adminEmail(me))) return notFound();

  const q = new URL(req.url).searchParams.get("user") ?? "";
  const user = await resolveUser(q);
  if (!user) return NextResponse.json({ error: "No user matches that email / @username / id." }, { status: 404 });

  const [balances, recent] = await Promise.all([
    prisma.balance.findMany({ where: { userId: user.id }, orderBy: { symbol: "asc" } }),
    prisma.transaction.findMany({
      where: { userId: user.id, type: { in: ["deposit", "admin_adjust"] } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  return NextResponse.json({
    user: { id: user.id, email: user.email, username: user.username, name: user.name },
    balances: balances.map((b) => ({ symbol: b.symbol, kind: b.kind, amount: Number(b.amount) })),
    recent: recent.map((t) => ({
      id: t.id,
      type: t.type,
      asset: t.assetOut ?? t.assetIn,
      amount: Number(t.amountOut ?? t.amountIn ?? 0),
      note: t.note,
      createdAt: t.createdAt,
    })),
  });
}

const schema = z.object({
  user: z.string().min(1, "Provide the user's email, @username or id."),
  symbol: z.string().min(2).max(8),
  // Signed: positive credits, negative debits — in units of `symbol`.
  delta: z.number().finite().refine((n) => n !== 0, "delta can't be zero."),
  reason: z.string().min(3, "A reason is required (it's the audit trail)."),
  // Client-supplied unique id; makes the whole adjustment idempotent.
  idempotencyKey: z.string().regex(/^[a-zA-Z0-9._:-]{6,80}$/, "idempotencyKey must be 6-80 url-safe chars."),
});

export async function POST(req: Request) {
  const me = await getUserId();
  if (!me) return notFound();
  const admin = await adminEmail(me);
  if (!admin) return notFound();

  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await req.json());
  } catch (e: any) {
    const msg = e?.issues?.[0]?.message ?? "Invalid request.";
    return NextResponse.json({ error: msg }, { status: 422 });
  }

  const symbol = input.symbol.toUpperCase();
  if (!CRYPTO_BY_SYMBOL[symbol] && !FIAT_BY_CODE[symbol]) {
    return NextResponse.json({ error: `Unknown asset "${symbol}".` }, { status: 422 });
  }

  const user = await resolveUser(input.user);
  if (!user) return NextResponse.json({ error: "No user matches that email / @username / id." }, { status: 404 });

  const externalId = `adj_${input.idempotencyKey}`;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Idempotency + audit in one row. The unique externalId means a retry with
      // the same key throws P2002 and the whole adjustment rolls back.
      await tx.settlement.create({
        data: {
          userId: user.id,
          kind: "adjustment",
          provider: "admin",
          externalId,
          reference: externalId,
          status: "completed",
          asset: symbol,
          amount: new Prisma.Decimal(input.delta),
          raw: { adminEmail: admin, reason: input.reason, delta: input.delta } as Prisma.InputJsonValue,
        },
      });

      // Apply the change (creates the balance if needed; throws on overdraft).
      await adjust(tx, user.id, symbol, input.delta);

      // User-visible record, so the correction shows honestly in their activity.
      await tx.transaction.create({
        data: {
          userId: user.id,
          type: "admin_adjust",
          status: "completed",
          ...(input.delta >= 0
            ? { assetOut: symbol, amountOut: new Prisma.Decimal(input.delta) }
            : { assetIn: symbol, amountIn: new Prisma.Decimal(-input.delta) }),
          counterparty: `admin:${admin}`,
          note: input.reason,
          emoji: "🛠️",
          meta: { adminEmail: admin, reason: input.reason, delta: input.delta, idempotencyKey: input.idempotencyKey },
        },
      });

      const bal = await tx.balance.findUnique({ where: { userId_symbol: { userId: user.id, symbol } } });
      return { newBalance: bal ? Number(bal.amount) : 0 };
    });

    return NextResponse.json({
      ok: true,
      user: { id: user.id, email: user.email, username: user.username },
      symbol,
      kind: kindOf(symbol),
      delta: input.delta,
      newBalance: result.newBalance,
      reason: input.reason,
    });
  } catch (e: any) {
    // Already applied (same idempotencyKey) — report it as a no-op, not an error.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ ok: true, alreadyApplied: true, idempotencyKey: input.idempotencyKey }, { status: 200 });
    }
    // Overdraft (adjust throws ApiError with a message) or anything else.
    const msg = e?.message ?? "Adjustment failed.";
    const status = typeof e?.status === "number" ? e.status : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
