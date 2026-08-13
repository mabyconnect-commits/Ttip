import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized, ApiError } from "@/lib/api";
import { getAppState } from "@/lib/serialize";
import { adjust } from "@/lib/wallet";
import { convert } from "@/lib/prices";
import { requireWithdrawPin } from "@/lib/withdraw-pin";
import { notifyUser } from "@/lib/push";

/**
 * Paying — or declining — a split someone asked you for.
 *
 * The only place a split can move money, and it debits exactly one account:
 * the caller's own. The request id is looked up SCOPED TO THE CALLER, so a
 * request addressed to somebody else simply doesn't exist here — you cannot
 * pay on another person's behalf, and naming their id changes nothing.
 *
 * The PIN is the point. Money leaving a wallet because a third party typed a
 * username is what caused this; money leaves now only when its owner types
 * their PIN on their own device.
 */

const schema = z.object({
  id: z.string().min(1),
  decline: z.boolean().optional(),
  pin: z.string().optional(),
});

export async function POST(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const input = schema.parse(await req.json());

    // Scoped to the payer in the query itself — never fetched and then checked.
    const request = await prisma.splitRequest.findFirst({
      where: { id: input.id, payerId: userId },
      include: { organizer: { select: { id: true, username: true, defaultFiat: true } } },
    });
    if (!request) throw new ApiError("That request isn't yours or no longer exists.", 404);
    if (request.status !== "pending") throw new ApiError(`That request was already ${request.status}.`, 409);

    if (input.decline) {
      await prisma.splitRequest.updateMany({
        where: { id: request.id, payerId: userId, status: "pending" },
        data: { status: "declined" },
      });
      void notifyUser(request.organizerId, {
        title: "Split declined",
        body: `Your split request was declined.`,
        url: "/split",
        tag: `split:${request.id}`,
      });
      return ok({ ...(await getAppState(userId)), declined: true });
    }

    // Same bar as any other outbound payment.
    await requireWithdrawPin(userId, input.pin);

    const amount = Number(request.amount);
    const toOrganizer = await convert(amount, request.fiat, request.organizer.defaultFiat).catch(() => 0);
    if (!(toOrganizer > 0)) throw new ApiError("Rate unavailable, try again in a moment.", 503);

    await prisma.$transaction(async (tx) => {
      // Claim it first: two taps cannot pay the same split twice.
      const claimed = await tx.splitRequest.updateMany({
        where: { id: request.id, payerId: userId, status: "pending" },
        data: { status: "paid", paidAt: new Date() },
      });
      if (claimed.count !== 1) throw new ApiError("That request was already settled.", 409);

      // adjust() throws when the balance can't cover it, which rolls the whole
      // thing back — the request stays payable rather than silently vanishing.
      await adjust(tx, userId, request.fiat, -amount);
      await adjust(tx, request.organizerId, request.organizer.defaultFiat, toOrganizer);

      await tx.transaction.create({
        data: {
          userId,
          type: "ttip_out",
          status: "completed",
          assetOut: request.fiat,
          amountOut: new Prisma.Decimal(amount),
          counterparty: "@" + request.organizer.username,
          note: request.note ? `Split: ${request.note}` : "Bill split",
          emoji: "🧾",
        },
      });
      await tx.transaction.create({
        data: {
          userId: request.organizerId,
          type: "ttip_in",
          status: "completed",
          assetOut: request.organizer.defaultFiat,
          amountOut: new Prisma.Decimal(toOrganizer),
          counterparty: "Split",
          note: request.note ? `Split settled: ${request.note}` : "Bill split settled",
          emoji: "🧾",
        },
      });
    });

    void notifyUser(request.organizerId, {
      title: "Split paid",
      body: `${request.organizer.defaultFiat} ${toOrganizer.toLocaleString("en-US", {
        maximumFractionDigits: 2,
      })} landed in your wallet.`,
      url: "/split",
      tag: `split:${request.id}`,
    });

    return ok({ ...(await getAppState(userId)), paid: { amount, fiat: request.fiat } });
  });
}
