import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized, ApiError } from "@/lib/api";
import { getAppState } from "@/lib/serialize";
import { convert } from "@/lib/prices";
import { adjust } from "@/lib/wallet";

const schema = z.object({
  total: z.number().positive(),
  fiat: z.string().default("NGN"),
  note: z.string().max(140).optional(),
  participants: z.array(z.string()).min(1, "Add at least one person"),
  splitEvenly: z.boolean().default(true),
});

// Organizer creates a split; each on-platform participant settles their share instantly.
export async function POST(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const me = await prisma.user.findUnique({ where: { id: userId } });
    if (!me) return unauthorized();

    const input = schema.parse(await req.json());
    const heads = input.participants.length + 1; // include organizer
    const share = input.total / heads;

    const handles = input.participants.map((p) => p.trim().replace(/^@/, "").toLowerCase());
    const participants = await prisma.user.findMany({ where: { username: { in: handles } } });
    if (participants.length === 0) throw new ApiError("None of those people are on Ttip yet", 400);

    let collected = 0;
    await prisma.$transaction(async (tx) => {
      for (const p of participants) {
        const shareInFiat = await convert(share, input.fiat, p.defaultFiat);
        try {
          await adjust(tx, p.id, p.defaultFiat, -shareInFiat);
        } catch {
          continue; // skip anyone who can't cover their share
        }
        collected += share;
        await tx.transaction.create({
          data: {
            userId: p.id,
            type: "ttip_out",
            assetOut: p.defaultFiat,
            amountOut: new Prisma.Decimal(shareInFiat),
            counterparty: "@" + me.username,
            note: input.note ? `Split: ${input.note}` : "Bill split",
            emoji: "🧾",
          },
        });
      }
      // credit organizer their collected amount
      const collectedInMyFiat = await convert(collected, input.fiat, me.defaultFiat);
      await adjust(tx, userId, me.defaultFiat, collectedInMyFiat);
      await tx.transaction.create({
        data: {
          userId,
          type: "ttip_in",
          assetOut: me.defaultFiat,
          amountOut: new Prisma.Decimal(collectedInMyFiat),
          counterparty: `${participants.length} friends`,
          note: input.note ? `Split settled: ${input.note}` : "Bill split settled",
          emoji: "🧾",
        },
      });
      await tx.feedItem.create({
        data: {
          actorId: userId,
          kind: "split",
          actorName: "@" + me.username,
          targetName: `${participants.length} friends`,
          amount: new Prisma.Decimal(input.total),
          currency: input.fiat,
          note: input.note,
          emoji: "🧾",
        },
      });
      await tx.user.update({ where: { id: userId }, data: { points: { increment: 80 } } });
    });

    const state = await getAppState(userId);
    return ok({
      ...state,
      receipt: {
        kind: "split",
        total: input.total,
        fiat: input.fiat,
        share,
        settled: participants.length,
        note: input.note,
      },
    });
  });
}
