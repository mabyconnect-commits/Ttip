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

/**
 * How many decimal places a token uses on a chain.
 *
 * This is what the mis-credit threw away: 725,902 is not seven hundred
 * thousand of anything, it is 0.725902 USDC with the point removed. USDT is the
 * awkward one — six decimals nearly everywhere, EIGHTEEN on BNB Chain — which
 * is exactly why the same bug looked mild on one chain and astronomical on
 * another.
 */
const DECIMALS: Record<string, number> = {
  USDC: 6,
  USDT: 6,
  TRX: 6,
  SOL: 9,
  BTC: 8,
  LTC: 8,
  DOGE: 8,
  ETH: 18,
  BNB: 18,
  MATIC: 18,
  AVAX: 18,
};

function decimalsFor(symbol: string, chainId?: number): number | null {
  const s = (symbol ?? "").toUpperCase();
  // USDT on BNB Chain is an 18-decimal contract, unlike everywhere else.
  if (s === "USDT" && chainId === 56) return 18;
  return DECIMALS[s] ?? null;
}

function firstPositive(...vals: unknown[]): number {
  for (const v of vals) {
    const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

export interface Correction {
  /** What the balance SHOULD have been. */
  corrected: number;
  /** Why we believe that, in words an operator can check. */
  basis: string;
}

/**
 * What this deposit should have credited.
 *
 * Two sources, best first. The provider's own formatted figure, kept in the
 * stored payload, is exact — no arithmetic, no assumption. Failing that, divide
 * by the token's decimals. If neither is available we return null and refuse to
 * guess: a wrong correction is a second mis-credit on top of the first.
 */
export function suggestCorrection(row: {
  asset: string;
  amount: number;
  chain: string | null;
  raw: unknown;
}): Correction | null {
  const payload = (row.raw ?? {}) as Record<string, unknown>;
  const d = ((payload.data as Record<string, unknown>) ?? payload) ?? {};

  const formatted = firstPositive(
    d.settlementAmountFormatted,
    d.destinationAmountFormatted,
    d.amountOutFormatted,
    d.settledAmountFormatted,
  );
  if (formatted > 0 && formatted < row.amount) {
    return { corrected: formatted, basis: "the provider's own formatted amount, from the stored payload" };
  }

  const dec = decimalsFor(row.asset, Number(row.chain) || undefined);
  if (dec == null) return null;
  const corrected = row.amount / 10 ** dec;
  if (!(corrected > 0)) return null;
  return { corrected, basis: `${row.asset.toUpperCase()} uses ${dec} decimals, so the raw figure ÷ 10^${dec}` };
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
  /** What it should have been, when we can work that out. */
  correction: Correction | null;
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
      correction: suggestCorrection({ asset: r.asset, amount, chain: r.chain, raw: r.raw }),
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

/**
 * Set a mis-credited deposit to the amount it should have been — in one step.
 *
 * Reversing leaves the user at zero and someone then has to type the right
 * figure into the balance desk by hand, which is slow and is itself a chance to
 * fat-finger a number. This does both halves at once: take out what was wrongly
 * credited, put in what was actually deposited, and write down both figures.
 *
 * The correction is worked out from the provider's own formatted amount where
 * the payload kept one, and only falls back to dividing by the token's decimals
 * otherwise. If neither is possible it refuses — a wrong correction would be a
 * second mis-credit on top of the first.
 */
export async function correctDeposit(externalId: string): Promise<ReversalResult & { correctedTo?: number }> {
  try {
    return await prisma.$transaction(async (tx) => {
      const row = await tx.settlement.findUnique({ where: { externalId } });
      if (!row) return { externalId, reversed: false, reason: "no such deposit" };
      if (row.status !== "completed") return { externalId, reversed: false, reason: `already ${row.status}` };
      if (!row.userId) return { externalId, reversed: false, reason: "no user on the deposit" };

      const wrong = Number(row.amount);
      const fix = suggestCorrection({ asset: row.asset, amount: wrong, chain: row.chain, raw: row.raw });
      if (!fix) {
        return { externalId, reversed: false, reason: `cannot determine the right amount for ${row.asset}` };
      }

      // Claim it, so a second click can't apply the correction twice.
      const claimed = await tx.settlement.updateMany({
        where: { externalId, status: "completed" },
        data: { status: "corrected", amount: new Prisma.Decimal(fix.corrected) },
      });
      if (claimed.count !== 1) return { externalId, reversed: false, reason: "raced by another correction" };

      const userId = row.userId;
      const symbol = row.asset;
      const balance = await tx.balance.findUnique({ where: { userId_symbol: { userId, symbol } } });
      const held = balance ? Number(balance.amount) : 0;

      // Take out the wrong figure, put back the right one. Floored at zero so a
      // partly-spent phantom balance can't push the wallet negative.
      const next = Math.max(0, held - wrong + fix.corrected);
      const shortfall = Math.max(0, wrong - held);

      if (balance) {
        await tx.balance.update({ where: { userId_symbol: { userId, symbol } }, data: { amount: new Prisma.Decimal(next) } });
      } else {
        await tx.balance.create({
          data: { userId, symbol, kind: "crypto", amount: new Prisma.Decimal(fix.corrected) },
        });
      }

      // Treasury moves by the same delta, so the platform ledger stays honest.
      await adjustTreasury(tx, symbol, fix.corrected - Math.min(held, wrong)).catch(() => {
        /* internal ledger — never block a user-facing correction */
      });

      const txn = await tx.transaction.findFirst({
        where: { userId, type: "deposit", meta: { path: ["externalId"], equals: externalId } },
      });
      if (txn) {
        await tx.transaction.update({
          where: { id: txn.id },
          data: {
            amountOut: new Prisma.Decimal(fix.corrected),
            note: `Received ${symbol} (corrected)`,
            meta: {
              ...((txn.meta ?? {}) as Record<string, unknown>),
              correctedAt: new Date().toISOString(),
              creditedInError: wrong,
              correctedTo: fix.corrected,
              correctionBasis: fix.basis,
            },
          },
        });
      }

      return { externalId, reversed: true, symbol, amount: wrong, correctedTo: fix.corrected, shortfall };
    });
  } catch (e) {
    console.error("[deposit] correction failed", externalId, e);
    return { externalId, reversed: false, reason: (e as Error).message };
  }
}
