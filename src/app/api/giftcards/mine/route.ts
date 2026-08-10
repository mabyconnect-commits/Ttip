import { z } from "zod";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized, ApiError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { openCode } from "@/lib/giftcard-secret";
import { rateLimit } from "@/lib/rate-limit";
import { reconcileGiftCards } from "@/lib/settlement/giftcard-reconcile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The cards someone has bought, and — only when they ask — the code itself.
 *
 * The list never carries a code. A screen that renders every code at once is
 * one screenshot, one shoulder, one screen-share away from giving them all
 * away, so the list shows ••••1234 and the code arrives on a deliberate tap.
 *
 * Revealing is recorded. If a user ever says "my card was already spent", the
 * only useful question is who has seen it and when, and that has to have been
 * written down before it was asked.
 */

export async function GET() {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();

    // Self-heal: a card whose code wasn't ready at purchase is fetched now, so
    // opening this screen is what finishes it rather than a wait for the cron.
    await reconcileGiftCards(10, userId).catch(() => {});

    const orders = await prisma.giftCardOrder.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return ok({
      cards: orders.map((o) => ({
        id: o.id,
        brand: o.brand,
        faceValue: Number(o.faceValue),
        faceCurrency: o.faceCurrency,
        costFiat: Number(o.costFiat),
        fiat: o.fiat,
        status: o.status,
        // Never the code — just enough to tell two cards apart.
        hint: o.codeHint,
        hasCode: !!o.codeCipher,
        revealedAt: o.revealedAt,
        error: o.status === "failed" ? o.error : null,
        createdAt: o.createdAt,
      })),
    });
  });
}

const reveal = z.object({ id: z.string().min(1) });

export async function POST(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const { id } = reveal.parse(await req.json());

    // A brake on someone walking an id space, or a stolen session pulling every
    // code an account owns in one go.
    rateLimit(`giftcard-reveal:${userId}`, { limit: 20, windowMs: 10 * 60_000 });

    // Scoped to the owner in the query itself — never fetched and then checked,
    // which is the shape that leaks when someone forgets the second step.
    const order = await prisma.giftCardOrder.findFirst({ where: { id, userId } });
    if (!order) throw new ApiError("Card not found.", 404);
    if (order.status !== "delivered" || !order.codeCipher) {
      throw new ApiError("That card isn't ready yet.", 409);
    }

    const code = openCode(order.codeCipher);
    if (!code) {
      // The key changed, or the row is corrupt. Say so plainly rather than
      // showing rubbish that someone will try to redeem.
      console.error(`[giftcard] could not decrypt ${order.id}`);
      throw new ApiError("We couldn't read that card — please contact support.", 500);
    }

    if (!order.revealedAt) {
      await prisma.giftCardOrder.update({ where: { id: order.id }, data: { revealedAt: new Date() } });
    }

    return ok({
      brand: order.brand,
      faceValue: Number(order.faceValue),
      faceCurrency: order.faceCurrency,
      code,
      pin: openCode(order.pinCipher),
    });
  });
}
