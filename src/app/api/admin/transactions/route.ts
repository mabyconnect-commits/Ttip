import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { explorerTxUrl } from "@/lib/chains";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Every transaction on the platform, in one place.
 *
 * Until now the only way to answer "what happened to this person's money" was
 * to sign in as them, or read the database by hand. Support questions arrive as
 * a name and an amount — "Kingsley says his ₦10,000 never landed" — and this is
 * the screen that turns that into an answer.
 *
 * Read-only, deliberately. Nothing here moves, reverses or edits money: the
 * actions that do live on the payout desk, where each one has a reason and an
 * audit row. A screen that shows everything AND changes anything is one where a
 * mis-tap while searching costs somebody their balance.
 *
 * Operator-only; a 404 for everyone else, because the endpoint's existence is
 * itself information.
 */

async function isAdmin(userId: string): Promise<boolean> {
  const raw = process.env.ADMIN_EMAILS ?? process.env.ADMIN_MAILS ?? "";
  const admins = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!admins.length) return false;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return !!user && admins.includes(user.email.toLowerCase());
}

const PAGE = 40;

export async function GET(req: Request) {
  const me = await getUserId();
  if (!me || !(await isAdmin(me))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const p = new URL(req.url).searchParams;
  const q = (p.get("q") ?? "").trim();
  const type = (p.get("type") ?? "").trim();
  const status = (p.get("status") ?? "").trim();
  const cursor = (p.get("cursor") ?? "").trim();
  const days = Number(p.get("days") ?? 0);

  const where: Prisma.TransactionWhereInput = {};
  if (type) where.type = type;
  if (status) where.status = status;
  if (days > 0) where.createdAt = { gte: new Date(Date.now() - days * 86_400_000) };

  /**
   * Search the way a support question arrives.
   *
   * Nobody has a transaction id — they have a name, a phone number, an account
   * number they paid, or a reference from a receipt. All of those are matched,
   * so the answer is one box rather than four filters.
   */
  if (q) {
    where.OR = [
      { counterparty: { contains: q, mode: "insensitive" } },
      { note: { contains: q, mode: "insensitive" } },
      { id: { startsWith: q } },
      { user: { email: { contains: q, mode: "insensitive" } } },
      { user: { username: { contains: q, mode: "insensitive" } } },
      { user: { name: { contains: q, mode: "insensitive" } } },
    ];
  }

  const rows = await prisma.transaction.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: PAGE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { user: { select: { email: true, username: true, name: true } } },
  });

  const hasMore = rows.length > PAGE;
  const page = hasMore ? rows.slice(0, PAGE) : rows;

  return NextResponse.json({
    transactions: page.map((t) => {
      const meta = (t.meta ?? {}) as {
        chainId?: number | string;
        txHash?: string;
        reference?: string;
        surface?: string;
        fundingError?: string;
        network?: string;
      };
      return {
        id: t.id,
        type: t.type,
        status: t.status,
        assetIn: t.assetIn,
        amountIn: t.amountIn ? Number(t.amountIn) : null,
        assetOut: t.assetOut,
        amountOut: t.amountOut ? Number(t.amountOut) : null,
        counterparty: t.counterparty,
        note: t.note,
        emoji: t.emoji,
        createdAt: t.createdAt,
        user: { email: t.user.email, username: t.user.username, name: t.user.name },
        // The two things that answer "why didn't it work" without another click.
        reason: t.status === "completed" ? null : (meta.fundingError ?? null),
        reference: meta.reference ?? null,
        surface: meta.surface ?? null,
        network: meta.network ?? null,
        explorerUrl: explorerTxUrl(meta.chainId, meta.txHash),
      };
    }),
    nextCursor: hasMore ? page[page.length - 1].id : null,
    // Counts for the filter chips, over the same window — so "12 pending" is
    // the number of things actually needing attention, not a total since launch.
    counts: await counts(where),
  });
}

/**
 * How many are pending and how many failed, under the current filters.
 *
 * Cheap enough to run per request and worth far more than it costs: an operator
 * opening this screen wants to know whether anything is wrong before they read
 * a single row.
 */
async function counts(where: Prisma.TransactionWhereInput) {
  const base = { ...where };
  delete base.status;
  const [total, pending, failed] = await Promise.all([
    prisma.transaction.count({ where: base }),
    prisma.transaction.count({ where: { ...base, status: "pending" } }),
    prisma.transaction.count({ where: { ...base, status: "failed" } }),
  ]);
  return { total, pending, failed };
}
