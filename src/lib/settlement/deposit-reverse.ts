import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { adjustTreasury } from "./treasury";
import { FIAT_BY_CODE } from "../constants";

/**
 * Undoing a deposit that should never have been credited.
 *
 * A deposit arrived in RAW BASE UNITS and was credited verbatim — ten
 * quintillion USDT in a wallet, spendable. This takes those back out.
 *
 * It touches NOTHING in the deposit path. It reads settlements and writes
 * corrections, and it imports nothing from the crediting code, so keeping it
 * can never be a reason to reopen deposits.
 *
 * Three rules, because reversing money is as dangerous as crediting it:
 *
 *  1. NOTHING IS REVERSED WITHOUT BEING LISTED FIRST. `suspectDeposits()`
 *     returns exactly what would be touched. An operator reads it, then
 *     confirms. There is no "reverse everything" that hasn't been shown.
 *  2. A REVERSAL IS ITSELF IDEMPOTENT AND RECORDED. The settlement row flips to
 *     "reversed" inside the same transaction as the balance change, so a double
 *     click can't debit twice, and the ledger shows what happened rather than
 *     the money quietly disappearing.
 *  3. A BALANCE NEVER GOES NEGATIVE. If some of the phantom money was already
 *     spent, the balance floors at zero and the shortfall is recorded — an
 *     operator needs to know a real loss happened rather than see it hidden.
 */

/**
 * The most of one crypto asset a single deposit can hold without looking wrong.
 *
 * Deliberately self-contained — this tool reads and reverses, it does not sit in
 * the deposit path and must never be a reason to touch it.
 */
export function depositUnitCeiling(): number {
  const raw = (process.env.DEPOSIT_MAX_UNITS ?? "").trim();
  const n = Number(raw);
  return raw !== "" && Number.isFinite(n) && n > 0 ? n : 1_000_000;
}

/**
 * An amount too large to be a real deposit.
 *
 * A $0.10 deposit credited as 10,290,000,000,000,000,000 USDT — 10.29 tokens in
 * RAW BASE UNITS on an 18-decimal contract. Fiat is exempt: a million naira is
 * an ordinary sum.
 */
export function implausibleDeposit(symbol: string, amount: number): boolean {
  if (!Number.isFinite(amount) || amount <= 0) return true;
  if (FIAT_BY_CODE[symbol.toUpperCase() as keyof typeof FIAT_BY_CODE]) return false;
  return amount > depositUnitCeiling();
}

export interface SuspectDeposit {
  externalId: string;
  userId: string | null;
  symbol: string;
  amount: number;
  balanceNow: number;
  chain: string | null;
  createdAt: Date;
  reason: string;
}

/**
 * Credited deposits that look like raw base units rather than real amounts.
 *
 * Deliberately narrow: only crypto deposits above the unit ceiling. It does NOT
 * sweep up every deposit, because "reverse everything recent" would take back
 * the legitimate ones too.
 */
export async function suspectDeposits(limit = 100): Promise<SuspectDeposit[]> {
  const rows = await prisma.settlement.findMany({
    where: { kind: "deposit", status: "completed" },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(limit, 500)),
  });

  const out: SuspectDeposit[] = [];
  for (const r of rows) {
    const amount = Number(r.amount);
    if (!implausibleDeposit(r.asset, amount)) continue;
    const balance = r.userId
      ? await prisma.balance.findUnique({ where: { userId_symbol: { userId: r.userId, symbol: r.asset } } })
      : null;
    out.push({
      externalId: r.externalId,
      userId: r.userId,
      symbol: r.asset,
      amount,
      balanceNow: balance ? Number(balance.amount) : 0,
      chain: r.chain,
      createdAt: r.createdAt,
      reason: `${amount} ${r.asset} is above the ${depositUnitCeiling()} unit ceiling — almost certainly raw base units`,
    });
  }
  return out;
}

export interface ReversalResult {
  externalId: string;
  reversed: boolean;
  symbol?: string;
  amount?: number;
  /** How much of it had already been spent and could not be taken back. */
  shortfall?: number;
  reason?: string;
}

/** Take one credited deposit back out of the user's balance and the treasury. */
export async function reverseDeposit(externalId: string, note = "mis-credited deposit"): Promise<ReversalResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const row = await tx.settlement.findUnique({ where: { externalId } });
      if (!row) return { externalId, reversed: false, reason: "no such deposit" };
      if (row.kind !== "deposit") return { externalId, reversed: false, reason: `not a deposit (${row.kind})` };
      // Claim it first. A second call finds it already reversed and stops here,
      // so a double click cannot debit the user twice.
      if (row.status !== "completed") {
        return { externalId, reversed: false, reason: `already ${row.status}` };
      }
      const claimed = await tx.settlement.updateMany({
        where: { externalId, status: "completed" },
        data: { status: "reversed" },
      });
      if (claimed.count !== 1) return { externalId, reversed: false, reason: "raced by another reversal" };

      const symbol = row.asset;
      const amount = Number(row.amount);
      const userId = row.userId;
      if (!userId) return { externalId, reversed: false, reason: "no user on the deposit" };

      const balance = await tx.balance.findUnique({ where: { userId_symbol: { userId, symbol } } });
      const held = balance ? Number(balance.amount) : 0;
      // Floor at zero. Going negative would make the shortfall invisible by
      // turning it into a debt the app has no concept of.
      const take = Math.min(held, amount);
      const shortfall = amount - take;

      if (balance) {
        await tx.balance.update({
          where: { userId_symbol: { userId, symbol } },
          data: { amount: new Prisma.Decimal(held - take) },
        });
      }

      // The treasury was credited on the way in, so it comes back out too —
      // only by what was actually recoverable.
      await adjustTreasury(tx, symbol, -take).catch(() => {
        /* treasury is an internal ledger; never block a user-facing reversal */
      });

      const txn = await tx.transaction.findFirst({
        where: { userId, type: "deposit", meta: { path: ["externalId"], equals: externalId } },
      });
      if (txn) {
        await tx.transaction.update({
          where: { id: txn.id },
          data: {
            status: "failed",
            note: `Reversed — ${note}`,
            meta: {
              ...((txn.meta ?? {}) as Record<string, unknown>),
              reversedAt: new Date().toISOString(),
              reversedAmount: take,
              shortfall,
              reversalNote: note,
            },
          },
        });
      }

      return { externalId, reversed: true, symbol, amount, shortfall };
    });
  } catch (e) {
    console.error("[deposit] reversal failed", externalId, e);
    return { externalId, reversed: false, reason: (e as Error).message };
  }
}

/** Reverse a named list. The caller has already seen exactly what these are. */
export async function reverseDeposits(externalIds: string[], note?: string): Promise<ReversalResult[]> {
  const out: ReversalResult[] = [];
  for (const id of externalIds.slice(0, 200)) out.push(await reverseDeposit(id, note));
  return out;
}
