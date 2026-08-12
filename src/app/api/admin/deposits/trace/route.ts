import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Where did a deposit go? READ ONLY.
 *
 * This writes nothing and imports nothing from the crediting path. It exists
 * because when a user says "my 2.4 SOL didn't arrive", the only useful question
 * is which of three things happened, and until now there was no way to see it:
 *
 *   1. A settlement row exists and is "completed" → we credited it; the problem
 *      is display or the user is looking at the wrong wallet.
 *   2. A row exists with status "review" → the guard refused to credit it.
 *      Nothing in the app surfaces that status, so it looked like nothing.
 *   3. No row at all → the webhook never reached us, or it couldn't match the
 *      address to a user. That is a provider/config question, not a code one.
 *
 * Guessing between those three is what went wrong before. This answers it.
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

export async function GET(req: Request) {
  const me = await getUserId();
  if (!me || !(await isAdmin(me))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();

  // Narrow to one user when asked, otherwise the most recent deposits overall.
  let userId: string | undefined;
  if (q) {
    const handle = q.replace(/^@/, "");
    const user = await prisma.user.findFirst({
      where: { OR: [{ id: q }, { email: q }, { username: handle }] },
      select: { id: true },
    });
    userId = user?.id;
  }

  const rows = await prisma.settlement.findMany({
    where: { kind: "deposit", ...(userId ? { userId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 25,
  });

  const deposits = await Promise.all(
    rows.map(async (r) => {
      // Did the user actually get a transaction out of it? A settlement without
      // one is money we recorded and never showed anybody.
      const txn = r.userId
        ? await prisma.transaction.findFirst({
            where: { userId: r.userId, type: "deposit", meta: { path: ["externalId"], equals: r.externalId } },
            select: { id: true, status: true, assetOut: true, amountOut: true },
          })
        : null;
      const user = r.userId
        ? await prisma.user.findUnique({ where: { id: r.userId }, select: { username: true, email: true } })
        : null;
      const balance =
        r.userId && txn?.assetOut
          ? await prisma.balance.findUnique({
              where: { userId_symbol: { userId: r.userId, symbol: txn.assetOut } },
            })
          : null;

      return {
        externalId: r.externalId,
        status: r.status,
        asset: r.asset,
        amount: Number(r.amount),
        chain: r.chain,
        address: r.address,
        user: user ? (user.username ?? user.email) : r.userId ? r.userId : "— no user matched —",
        transaction: txn ? { status: txn.status, asset: txn.assetOut, amount: Number(txn.amountOut ?? 0) } : null,
        balanceNow: balance ? Number(balance.amount) : null,
        createdAt: r.createdAt,
        // The one-line reading of this row.
        verdict:
          r.status === "review"
            ? "HELD — refused by the asset guard, never credited"
            : r.status === "completed" && txn
              ? "Credited normally"
              : r.status === "completed"
                ? "Settlement completed but NO transaction — credited silently"
                : `Settlement is "${r.status}"`,
      };
    }),
  );

  return NextResponse.json({
    query: q || "(most recent)",
    matchedUser: q ? !!userId : undefined,
    count: deposits.length,
    deposits,
    note:
      deposits.length === 0
        ? "No deposit rows at all. The webhook never arrived, or it could not match the deposit address to a user — check the Vercel logs for /api/webhooks/deposit."
        : undefined,
  });
}
