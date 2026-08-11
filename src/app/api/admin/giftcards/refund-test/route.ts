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

export async function POST() {
  const userId = await getUserId();
  if (!userId || !(await isAdmin(userId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(await refundTestModeOrders());
}
