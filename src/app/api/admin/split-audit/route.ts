import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { adjust } from "@/lib/wallet";

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


/**
 * Give a victim their money back, and take it off whoever took it.
 *
 * Targeted at ONE beneficiary by username, because the audit showed the debits
 * are not all abuse — an operator testing their own accounts appears in the
 * same list as somebody who found the hole and used it five times. A blanket
 * reversal would undo both.
 *
 * Each original debit is marked reversed inside the same transaction as the
 * balance moves, so running this twice cannot pay a victim twice or take from
 * the beneficiary twice.
 *
 * The beneficiary's balance floors at zero. If they have already spent or
 * withdrawn it, the shortfall is reported rather than hidden — the victim is
 * still made whole, and the loss becomes a number you can act on instead of a
 * silent gap.
 */
export async function POST(req: Request) {
  const me = await getUserId();
  if (!me || !(await isAdmin(me))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { beneficiary?: string; confirm?: boolean };
  const beneficiary = (body.beneficiary ?? "").trim().replace(/^@/, "");
  if (!beneficiary) return NextResponse.json({ error: "Name the account that received the money." }, { status: 400 });

  const taker = await prisma.user.findFirst({
    where: { username: beneficiary },
    select: { id: true, username: true },
  });
  if (!taker) return NextResponse.json({ error: `No user @${beneficiary}` }, { status: 404 });

  const debits = await prisma.transaction.findMany({
    where: {
      type: "ttip_out",
      counterparty: "@" + beneficiary,
      OR: [{ note: { startsWith: "Split:" } }, { note: "Bill split" }],
    },
    orderBy: { createdAt: "asc" },
    take: 200,
    include: { user: { select: { username: true } } },
  });

  const pending = debits.filter((d) => !(d.meta as { splitReversedAt?: string } | null)?.splitReversedAt);

  if (!body.confirm) {
    return NextResponse.json({
      beneficiary,
      wouldReverse: pending.length,
      total: pending.reduce((n, d) => n + Number(d.amountOut ?? 0), 0),
      charges: pending.map((d) => ({
        when: d.createdAt,
        victim: d.user?.username,
        amount: Number(d.amountOut ?? 0),
        fiat: d.assetOut,
      })),
      howToApply: 'POST again with { "beneficiary": "' + beneficiary + '", "confirm": true }',
    });
  }

  const results = [];
  let shortfallTotal = 0;

  for (const d of pending) {
    const amount = Number(d.amountOut ?? 0);
    const fiat = d.assetOut ?? "NGN";
    if (!(amount > 0) || !d.userId) continue;

    try {
      const outcome = await prisma.$transaction(async (tx) => {
        // Claim the original debit so this can never run twice on it.
        const claimed = await tx.transaction.updateMany({
          where: { id: d.id, meta: { path: ["splitReversedAt"], equals: Prisma.DbNull } },
          data: {
            meta: {
              ...((d.meta ?? {}) as Record<string, unknown>),
              splitReversedAt: new Date().toISOString(),
              splitReversedBy: me,
            },
          },
        });
        if (claimed.count !== 1) return { skipped: true, shortfall: 0 };

        // Take it back, only as far as they actually still hold.
        const held = await tx.balance.findUnique({
          where: { userId_symbol: { userId: taker.id, symbol: fiat } },
        });
        const have = held ? Number(held.amount) : 0;
        const take = Math.min(have, amount);
        const shortfall = amount - take;

        if (take > 0) {
          await tx.balance.update({
            where: { userId_symbol: { userId: taker.id, symbol: fiat } },
            data: { amount: new Prisma.Decimal(have - take) },
          });
        }

        // The victim is made whole in full, whatever the taker still had.
        await adjust(tx, d.userId!, fiat, amount);

        await tx.transaction.create({
          data: {
            userId: d.userId!,
            type: "ttip_in",
            status: "completed",
            assetOut: fiat,
            amountOut: new Prisma.Decimal(amount),
            counterparty: "Ttip",
            note: `Refund — unauthorised split charge by @${beneficiary}`,
            emoji: "↩️",
          },
        });
        await tx.transaction.create({
          data: {
            userId: taker.id,
            type: "ttip_out",
            status: "completed",
            assetOut: fiat,
            amountOut: new Prisma.Decimal(take),
            counterparty: "Ttip",
            note: `Reversed — unauthorised split charge${shortfall > 0 ? ` (${shortfall} unrecovered)` : ""}`,
            emoji: "↩️",
          },
        });

        return { skipped: false, shortfall };
      });

      if (outcome.skipped) continue;
      shortfallTotal += outcome.shortfall;
      results.push({ victim: d.user?.username, amount, fiat, shortfall: outcome.shortfall });
    } catch (e) {
      console.error("[split-audit] reversal failed", d.id, e);
      results.push({ victim: d.user?.username, amount, fiat, error: (e as Error).message });
    }
  }

  return NextResponse.json({
    beneficiary,
    reversed: results.filter((r) => !("error" in r)).length,
    refundedTotal: results.reduce((n, r) => n + ("error" in r ? 0 : r.amount), 0),
    unrecovered: shortfallTotal,
    results,
    note:
      shortfallTotal > 0
        ? `Victims were refunded in full. ${shortfallTotal} could not be taken back from @${beneficiary} — they had already spent it. That is a real loss to the platform.`
        : "Fully recovered from the account that took it.",
  });
}
