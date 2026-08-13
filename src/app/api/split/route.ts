import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized, ApiError } from "@/lib/api";
import { getAppState } from "@/lib/serialize";
import { convert } from "@/lib/prices";
import { rateLimit } from "@/lib/rate-limit";
import { notifyUser } from "@/lib/push";

/**
 * Splitting a bill — as a REQUEST, never a debit.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS REPLACES, and why it had to change immediately.
 *
 * The previous version did this, inside the organizer's own request:
 *
 *     await adjust(tx, p.id, p.defaultFiat, -shareInFiat);   // debit THEM
 *     await adjust(tx, userId, me.defaultFiat, collected);   // credit ME
 *
 * Naming somebody's username took money out of their wallet and put it in
 * yours. No consent. No PIN. No cap on the amount. No notification. A stranger
 * who knew your handle could empty your balance into their own in one request,
 * and people found it and did exactly that.
 *
 * There is no version of "debit another person because I asked" that is safe,
 * so the auto-debit is gone rather than guarded. A split now creates a pending
 * request. The person being asked sees it, and pays from their own device with
 * their own PIN, through /api/split/pay. Until they do, their balance is
 * untouched.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const schema = z.object({
  total: z.number().positive().max(100_000_000),
  fiat: z.string().min(3).max(4).default("NGN"),
  note: z.string().max(140).optional(),
  participants: z.array(z.string().min(1).max(40)).min(1, "Add at least one person").max(20),
  splitEvenly: z.boolean().default(true),
});

/** Create the requests. Moves no money whatsoever. */
export async function POST(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const me = await prisma.user.findUnique({ where: { id: userId } });
    if (!me) return unauthorized();

    // A split costs the organizer nothing, so without a limit it is free spam
    // — and previously it was free theft.
    rateLimit(`split:${userId}`, { limit: 10, windowMs: 60 * 60_000 });

    const input = schema.parse(await req.json());
    const heads = input.participants.length + 1; // the organizer pays a share too
    const share = input.total / heads;

    const handles = [...new Set(input.participants.map((p) => p.trim().replace(/^@/, "").toLowerCase()))];
    const participants = await prisma.user.findMany({ where: { username: { in: handles } } });
    if (participants.length === 0) throw new ApiError("None of those people are on Ttip yet", 400);

    const created: { username: string; amount: number; fiat: string }[] = [];

    for (const p of participants) {
      // Asking yourself for money is nonsense, and was a way to loop value.
      if (p.id === userId) continue;

      const shareInTheirFiat = await convert(share, input.fiat, p.defaultFiat).catch(() => 0);
      if (!(shareInTheirFiat > 0)) continue;

      const request = await prisma.splitRequest.create({
        data: {
          organizerId: userId,
          payerId: p.id,
          amount: new Prisma.Decimal(shareInTheirFiat),
          fiat: p.defaultFiat,
          note: input.note,
          status: "pending",
        },
      });

      created.push({ username: p.username, amount: shareInTheirFiat, fiat: p.defaultFiat });

      // They must know they've been asked — silence is what let this be abused.
      void notifyUser(p.id, {
        title: `@${me.username} asked you to split a bill`,
        body: `${p.defaultFiat} ${shareInTheirFiat.toLocaleString("en-US", { maximumFractionDigits: 2 })}${
          input.note ? ` for ${input.note}` : ""
        }. Nothing has left your wallet — open Ttip to pay or decline.`,
        url: "/split",
        tag: `split:${request.id}`,
      });
    }

    if (created.length === 0) throw new ApiError("Nobody to ask — check the usernames.", 400);

    const state = await getAppState(userId);
    return ok({
      ...state,
      receipt: {
        kind: "split",
        total: input.total,
        fiat: input.fiat,
        share,
        requested: created.length,
        note: input.note,
        pending: created,
        message: "Requests sent. Nobody is charged until they approve it themselves.",
      },
    });
  });
}

/** Splits waiting on me, and the ones I've asked for. */
export async function GET() {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();

    const [incoming, outgoing] = await Promise.all([
      prisma.splitRequest.findMany({
        where: { payerId: userId, status: "pending" },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { organizer: { select: { username: true, name: true } } },
      }),
      prisma.splitRequest.findMany({
        where: { organizerId: userId },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { payer: { select: { username: true } } },
      }),
    ]);

    return ok({
      incoming: incoming.map((r) => ({
        id: r.id,
        from: r.organizer.username,
        fromName: r.organizer.name,
        amount: Number(r.amount),
        fiat: r.fiat,
        note: r.note,
        createdAt: r.createdAt,
      })),
      outgoing: outgoing.map((r) => ({
        id: r.id,
        to: r.payer.username,
        amount: Number(r.amount),
        fiat: r.fiat,
        note: r.note,
        status: r.status,
        createdAt: r.createdAt,
      })),
    });
  });
}
