import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { refundTestModeOrders } from "@/lib/settlement/giftcard-order";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Refund every gift card bought while the sandbox provider was active.
 *
 * No preview step, unlike the deposit reversal. There is no judgement call to
 * make here: a sandbox card is fake by definition, the user paid real money for
 * it, and the only correct action is to give all of it back.
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

/**
 * GET shows what would be refunded; GET with ?confirm=yes does it.
 *
 * A mutating GET is normally the wrong shape, and it is deliberate here: the
 * operator runs this from a phone browser, where the only thing you can do to a
 * URL is open it. A POST-only endpoint is one that cannot be used at all, and an
 * unusable refund tool leaves real money with the wrong people. The blast radius
 * is bounded — admin session required, idempotent, and the only effect is giving
 * users back money we should not have taken.
 */
export async function GET(req: Request) {
  const userId = await getUserId();
  if (!userId || !(await isAdmin(userId))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (new URL(req.url).searchParams.get("confirm") === "yes") {
    return NextResponse.json({ done: true, ...(await refundTestModeOrders()) });
  }

  const pending = await prisma.giftCardOrder.findMany({
    where: { provider: "sandbox", status: { in: ["pending", "delivered"] } },
    take: 500,
  });
  return NextResponse.json({
    toRefund: pending.length,
    totalByCurrency: pending.reduce<Record<string, number>>((acc, o) => {
      acc[o.fiat] = (acc[o.fiat] ?? 0) + Number(o.costFiat);
      return acc;
    }, {}),
    orders: pending.map((o) => ({
      brand: o.brand,
      faceValue: Number(o.faceValue),
      charged: Number(o.costFiat),
      fiat: o.fiat,
      status: o.status,
      createdAt: o.createdAt,
    })),
    howToApply: "Open this same URL with ?confirm=yes on the end to refund all of them.",
  });
}

export async function POST() {
  const userId = await getUserId();
  if (!userId || !(await isAdmin(userId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(await refundTestModeOrders());
}
