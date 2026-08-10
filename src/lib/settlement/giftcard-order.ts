import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isCrypto } from "@/lib/prices";
import { sealCode, codeHint } from "@/lib/giftcard-secret";
import { notifyUser } from "@/lib/push";

/**
 * The two endings a gift card order can have.
 *
 * They live here rather than in the buy route because the reconciler reaches
 * for them too, and a background job importing an HTTP route to settle money is
 * the kind of coupling that breaks quietly the first time the route grows a
 * side effect at module scope.
 */

/** Store the code, encrypted, and mark the order delivered. */
export async function deliverOrder(
  reference: string,
  providerRef: string | undefined,
  code: string,
  pin?: string,
): Promise<void> {
  const order = await prisma.giftCardOrder.findUnique({ where: { reference } });
  if (!order || order.status === "delivered") return;

  await prisma.$transaction(async (tx) => {
    await tx.giftCardOrder.update({
      where: { reference },
      data: {
        status: "delivered",
        providerRef: providerRef ?? order.providerRef,
        codeCipher: sealCode(code),
        codeHint: codeHint(code),
        pinCipher: pin ? sealCode(pin) : null,
        deliveredAt: new Date(),
        error: null,
      },
    });
    const txn = await tx.transaction.findFirst({
      where: { userId: order.userId, type: "giftcard", meta: { path: ["reference"], equals: reference } },
    });
    if (txn) await tx.transaction.update({ where: { id: txn.id }, data: { status: "completed" } });
  });

  void notifyUser(order.userId, {
    title: "Gift card ready",
    body: `Your ${order.brand} ${order.faceCurrency} ${Number(order.faceValue)} card is in the app.`,
    url: "/giftcards",
    tag: "giftcard",
  });
}

/**
 * Give the money back, every leg of it.
 *
 * Only ever called when the provider DEFINITELY didn't sell us a card. An
 * ambiguous response is left pending for the reconciler, because refunding a
 * card that was actually bought hands back the money and the card.
 */
export async function refundOrder(reference: string, reason: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const order = await tx.giftCardOrder.findUnique({ where: { reference } });
    if (!order || order.status !== "pending") return;

    await tx.giftCardOrder.update({
      where: { reference },
      data: { status: "failed", error: reason.slice(0, 400) },
    });

    const txn = await tx.transaction.findFirst({
      where: { userId: order.userId, type: "giftcard", meta: { path: ["reference"], equals: reference } },
    });
    if (!txn) return;
    await tx.transaction.update({ where: { id: txn.id }, data: { status: "failed" } });

    const legs = (txn.meta as { legs?: { symbol: string; take: number }[] } | null)?.legs ?? [];
    for (const leg of legs) {
      await tx.balance.upsert({
        where: { userId_symbol: { userId: order.userId, symbol: leg.symbol } },
        create: {
          userId: order.userId,
          symbol: leg.symbol,
          kind: isCrypto(leg.symbol) ? "crypto" : "fiat",
          amount: new Prisma.Decimal(leg.take),
        },
        update: { amount: { increment: leg.take } },
      });
    }
  });
  console.error(`[giftcard] refunded ${reference}: ${reason}`);
}
