import "server-only";
import { prisma } from "@/lib/db";
import { giftCardProvider } from "./giftcard";
import { deliverOrder, refundOrder } from "./giftcard-order";

/**
 * Finishing gift card orders the purchase call couldn't finish itself.
 *
 * Two things leave an order pending, and they need opposite endings:
 *
 *  1. The order was placed and accepted, but the code wasn't ready yet. The
 *     distributor is still pulling one from stock. That ends in DELIVERY, once
 *     the code appears — asking again is the whole job.
 *
 *  2. The call threw, or the response was unreadable, so we never learned
 *     whether an order exists at all. That is the dangerous one. Refunding a
 *     card that WAS bought hands back the money and the card, so nothing here
 *     refunds on a timeout. We ask the provider, by our own reference, whether
 *     the order exists — and only a definite "no such order", after a grace
 *     window, releases the money.
 *
 * Anything the provider can't answer stays pending. Money held is a support
 * ticket; money given back twice is a loss that never comes back.
 */

/** How long an unplaced order is left alone before it can be refunded. */
const GRACE_MS = 10 * 60_000;

export interface GiftCardReconcileResult {
  checked: number;
  delivered: number;
  refunded: number;
}

export async function reconcileGiftCards(limit = 25, userId?: string): Promise<GiftCardReconcileResult> {
  const provider = giftCardProvider();
  const result: GiftCardReconcileResult = { checked: 0, delivered: 0, refunded: 0 };

  const pending = await prisma.giftCardOrder.findMany({
    where: {
      status: "pending",
      ...(userId ? { userId } : {}),
      // A few seconds of grace: an order created by the request that is still
      // running shouldn't be raced by the cron.
      createdAt: { lte: new Date(Date.now() - 20_000) },
    },
    orderBy: { createdAt: "asc" },
    take: Math.max(1, Math.min(limit, 100)),
  });

  for (const order of pending) {
    result.checked++;

    // An order placed with a different provider than the one configured now
    // (a mid-flight swap of adapters) can't be asked about here.
    if (order.provider !== provider.name) continue;

    let providerRef = order.providerRef ?? undefined;

    if (!providerRef) {
      // Case 2: we don't know if it was ever placed. Ask by our reference.
      const found = await provider.findByReference(order.reference).catch(() => null);
      if (!found) continue; // uncertain — leave it alone
      if (!found.found) {
        if (Date.now() - order.createdAt.getTime() < GRACE_MS) continue;
        await refundOrder(order.reference, "The provider has no record of this order.").catch((e) =>
          console.error("[giftcard] refund failed", order.reference, e),
        );
        result.refunded++;
        continue;
      }
      providerRef = found.providerRef;
      if (!providerRef) continue;
      await prisma.giftCardOrder.updateMany({ where: { reference: order.reference }, data: { providerRef } });
    }

    // Case 1: it exists — is the code ready?
    const card = await provider.fetchCode(providerRef).catch(() => null);
    if (!card?.code) continue;

    await deliverOrder(order.reference, providerRef, card.code, card.pin).catch((e) =>
      console.error("[giftcard] deliver failed", order.reference, e),
    );
    result.delivered++;
  }

  return result;
}
