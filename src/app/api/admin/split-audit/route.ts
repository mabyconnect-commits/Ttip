import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Every debit the old split route took without the owner's consent.
 *
 * The route paired each victim's "ttip_out" with the organizer's "ttip_in" in
 * one transaction, so the pair is recoverable: a Split debit names the
 * organizer as counterparty, and the settlement lands with that organizer
 * seconds later. This reconstructs who was charged, who received it, and how
 * much — which is what any refund, suspension or police report needs.
 *
 * READ ONLY. It reverses nothing: taking money back off an account that may
 * have already withdrawn it is a decision with legal weight, and it belongs to
 * a person, not to a sweep.
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

  const days = Number(new URL(req.url).searchParams.get("days"));
  const since = Number.isFinite(days) && days > 0 ? new Date(Date.now() - days * 864e5) : undefined;

  // Every debit the split route created. They all carry this note shape.
  const debits = await prisma.transaction.findMany({
    where: {
      type: "ttip_out",
      OR: [{ note: { startsWith: "Split:" } }, { note: "Bill split" }],
      ...(since ? { createdAt: { gte: since } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 500,
    include: { user: { select: { username: true, email: true } } },
  });

  // counterparty on the debit is "@organizer" — the account that received it.
  const byBeneficiary = new Map<
    string,
    { received: number; victims: Set<string>; charges: number; currencies: Set<string> }
  >();
  const rows = [];

  for (const d of debits) {
    const organizer = (d.counterparty ?? "").replace(/^@/, "");
    const amount = Number(d.amountOut ?? 0);
    const fiat = d.assetOut ?? "NGN";

    const entry = byBeneficiary.get(organizer) ?? {
      received: 0,
      victims: new Set<string>(),
      charges: 0,
      currencies: new Set<string>(),
    };
    entry.received += amount;
    entry.charges += 1;
    entry.currencies.add(fiat);
    if (d.user?.username) entry.victims.add(d.user.username);
    byBeneficiary.set(organizer, entry);

    rows.push({
      when: d.createdAt,
      chargedUser: d.user?.username ?? d.userId,
      chargedEmail: d.user?.email ?? null,
      amount,
      fiat,
      paidTo: organizer,
      note: d.note,
      transactionId: d.id,
    });
  }

  const beneficiaries = [...byBeneficiary.entries()]
    .map(([username, v]) => ({
      username,
      totalReceived: v.received,
      currencies: [...v.currencies],
      chargesTaken: v.charges,
      distinctVictims: v.victims.size,
      victims: [...v.victims],
    }))
    .sort((a, b) => b.totalReceived - a.totalReceived);

  return NextResponse.json({
    window: since ? `last ${days} days` : "all time",
    totalDebits: rows.length,
    beneficiaries,
    debits: rows,
    note:
      "Every one of these was taken without the account owner's approval — the old split route debited on the organizer's word alone. Ranked by who received the most. Nothing has been reversed.",
  });
}
