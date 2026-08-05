import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { kindOf } from "../wallet";
import { usdPrice } from "../prices";
import { resolveTokenSymbol } from "./dextopus";

/* ============================================================
   Repairing deposits mis-credited by the origin/settlement mix-up.

   THE BUG (fixed in ./webhook.ts and the deposit webhook route): a
   cross-chain deposit's settlement symbol could be paired with its
   *origin* amount, so someone who sent 0.4 SOL was credited "0.4 USDC" —
   relabelled, never converted. It loses money in both directions.

   This module finds those rows and corrects them. It is deliberately
   per-deposit: each correction moves real balance, so it is an explicit
   act, never a bulk sweep.
   ============================================================ */

export type RepairVerdict = "MIS_CREDITED" | "NEEDS_MANUAL";

export type DepositFinding = {
  settlementId: string;
  externalId: string;
  userId: string | null;
  userEmail: string | null;
  username: string | null;
  createdAt: string;
  /** What we actually credited the user. */
  creditedAsset: string;
  creditedAmount: number;
  /** What the provider says settled into treasury, when the payload carries it. */
  trueSettlementAsset: string | null;
  trueSettlementAmount: number | null;
  /** What the user actually sent. */
  originAsset: string | null;
  originAmount: number | null;
  /** Difference we owe them, when it can be computed. */
  delta: number | null;
  verdict: RepairVerdict;
  /** Already corrected once — shown so nobody double-credits. */
  alreadyRepaired: boolean;
  /**
   * What the origin amount is worth at today's price, less the provider fee.
   * Only present for NEEDS_MANUAL rows, where the payload carries no settled
   * figure. It is an ESTIMATE at the current market price, not the amount that
   * actually landed — the deposit may be days old and the price has moved.
   */
  estimate: {
    asset: string;
    amount: number;
    unitPriceUsd: number;
    feeRate: number;
    /** Why this number should be checked before it is applied. */
    caveat: string;
  } | null;
};

/** Dextopus takes roughly 0.25% per transfer. */
const PROVIDER_FEE_RATE = 0.0025;

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function sym(v: unknown): string | null {
  const s = v === null || v === undefined ? "" : String(v).toUpperCase().trim();
  return s || null;
}

/**
 * Scan completed Dextopus deposits for the mix-up. Read-only.
 *
 * MIS_CREDITED  — the payload carries a settlement pair that disagrees with
 *                 what we credited. Repairable automatically.
 * NEEDS_MANUAL  — the credited amount exactly equals an origin amount in a
 *                 different asset (the relabel signature), but the payload has
 *                 no settlement figure to correct it to. A human must price the
 *                 transfer on-chain and supply the number.
 */
export async function scanMislabelledDeposits(opts: { email?: string } = {}): Promise<DepositFinding[]> {
  const settlements = await prisma.settlement.findMany({
    where: {
      kind: "deposit",
      provider: "dextopus",
      status: "completed",
      ...(opts.email ? { user: { email: opts.email } } : {}),
    },
    include: { user: { select: { email: true, username: true } } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  // Anything already corrected, so the UI can grey it out.
  const repaired = await prisma.transaction.findMany({
    where: { counterparty: "Correction", meta: { path: ["kind"], equals: "deposit-correction" } },
    select: { meta: true },
  });
  const repairedIds = new Set(
    repaired
      .map((t) => (t.meta as { externalId?: string } | null)?.externalId)
      .filter((v): v is string => Boolean(v)),
  );

  const findings: DepositFinding[] = [];

  for (const s of settlements) {
    const raw = (s.raw ?? {}) as { data?: Record<string, unknown> };
    const d = raw.data ?? {};

    // Dextopus sends mint/contract ADDRESSES, not tickers. Resolve them before
    // comparing anything — comparing "USDC" against "EPjFWdd5…" reports a
    // mismatch that isn't real, and storing the address as a balance symbol
    // would be a fresh bug on top of the one we're fixing.
    const chainId = Number(d.settlementChainId ?? d.originChainId) || undefined;
    const originChainId = Number(d.originChainId) || undefined;

    const trueSettlementAsset =
      (await resolveTokenSymbol(String(d.settlementAsset ?? ""), chainId)) ?? null;
    const trueSettlementAmount = num(d.settlementAmountFormatted);
    const originAsset =
      (await resolveTokenSymbol(String(d.originAsset ?? ""), originChainId)) ?? null;
    const originAmount = num(d.originAmountFormatted);

    const creditedAsset = s.asset.toUpperCase();
    const creditedAmount = Number(s.amount);

    let verdict: RepairVerdict | null = null;

    if (trueSettlementAsset && trueSettlementAmount !== null) {
      if (
        creditedAsset !== trueSettlementAsset ||
        Math.abs(creditedAmount - trueSettlementAmount) > 1e-9
      ) {
        verdict = "MIS_CREDITED";
      }
    } else if (
      originAmount !== null &&
      originAsset &&
      originAsset !== creditedAsset &&
      Math.abs(creditedAmount - originAmount) < 1e-12
    ) {
      // The relabel signature: same number, different currency.
      verdict = "NEEDS_MANUAL";
    }

    if (!verdict) continue;

    // For the rows with no settled figure, work out what the deposit is worth
    // so the admin has a number to sanity-check rather than a blank box.
    let estimate: DepositFinding["estimate"] = null;
    if (verdict === "NEEDS_MANUAL" && originAsset && originAmount !== null) {
      const target = (process.env.DEXTOPUS_SETTLEMENT_ASSET || "USDC").toUpperCase();
      try {
        const [originUsd, targetUsd] = await Promise.all([
          usdPrice(originAsset),
          usdPrice(target),
        ]);
        if (originUsd > 0 && targetUsd > 0) {
          const gross = (originAmount * originUsd) / targetUsd;
          estimate = {
            asset: target,
            amount: Number((gross * (1 - PROVIDER_FEE_RATE)).toFixed(6)),
            unitPriceUsd: originUsd,
            feeRate: PROVIDER_FEE_RATE,
            caveat:
              "Estimated at today's price less the provider fee. The deposit settled earlier, so confirm against the treasury receipt before applying.",
          };
        }
      } catch {
        // No price feed — leave the admin to enter it by hand.
      }
    }

    findings.push({
      settlementId: s.id,
      externalId: s.externalId,
      userId: s.userId,
      userEmail: s.user?.email ?? null,
      username: s.user?.username ?? null,
      createdAt: s.createdAt.toISOString(),
      creditedAsset,
      creditedAmount,
      trueSettlementAsset,
      trueSettlementAmount,
      originAsset,
      originAmount,
      delta:
        trueSettlementAmount !== null && creditedAsset === trueSettlementAsset
          ? trueSettlementAmount - creditedAmount
          : null,
      verdict,
      alreadyRepaired: repairedIds.has(s.externalId),
      estimate,
    });
  }

  return findings;
}

export type RepairResult =
  | { ok: true; from: { asset: string; amount: number }; to: { asset: string; amount: number } }
  | { ok: false; error: string };

/**
 * Correct one deposit. Atomic: balance, settlement row and the user-visible
 * transaction all move together, plus an audit row so the correction itself is
 * never invisible.
 *
 * `manual` supplies the settled asset/amount for NEEDS_MANUAL rows, where the
 * provider payload has no figure to trust. Nothing is ever inferred.
 */
export async function repairDeposit(
  settlementId: string,
  actorEmail: string,
  manual?: { asset: string; amount: number },
): Promise<RepairResult> {
  const s = await prisma.settlement.findUnique({ where: { id: settlementId } });
  if (!s) return { ok: false, error: "Settlement not found." };
  if (!s.userId) return { ok: false, error: "Settlement has no user attached." };
  if (s.kind !== "deposit") return { ok: false, error: "Not a deposit." };

  // Refuse to correct the same deposit twice.
  const existing = await prisma.transaction.findFirst({
    where: {
      counterparty: "Correction",
      meta: { path: ["externalId"], equals: s.externalId },
    },
  });
  if (existing) return { ok: false, error: "This deposit has already been corrected." };

  const raw = (s.raw ?? {}) as { data?: Record<string, unknown> };
  const d = raw.data ?? {};

  const chainId = Number(d.settlementChainId ?? d.originChainId) || undefined;
  const payloadAsset = (await resolveTokenSymbol(String(d.settlementAsset ?? ""), chainId)) ?? null;
  const payloadAmount = num(d.settlementAmountFormatted);

  const targetAsset = manual
    ? (await resolveTokenSymbol(manual.asset, chainId)) ?? null
    : payloadAsset;
  const targetAmount = manual ? manual.amount : payloadAmount;

  if (!targetAsset || targetAmount === null || !(targetAmount > 0)) {
    return {
      ok: false,
      error:
        "No settled amount available. Look the transfer up on-chain and supply the settled asset and amount.",
    };
  }

  // A balance symbol must be a ticker. If an address slipped through
  // unresolved, refuse — a base58 string as a balance key is unrecoverable
  // without another migration.
  if (!/^[A-Z0-9]{2,10}$/.test(targetAsset)) {
    return {
      ok: false,
      error: `"${targetAsset}" is not a recognised ticker. Enter the settled asset as a symbol (e.g. USDC), not a contract address.`,
    };
  }

  const userId = s.userId;
  const wasAsset = s.asset.toUpperCase();
  const wasAmount = Number(s.amount);

  if (wasAsset === targetAsset && Math.abs(wasAmount - targetAmount) < 1e-9) {
    return { ok: false, error: "Already correct — nothing to change." };
  }

  await prisma.$transaction(async (tx) => {
    // Back out what was wrongly credited. Guard against driving a balance
    // negative if the user has already spent part of it.
    const current = await tx.balance.findUnique({
      where: { userId_symbol: { userId, symbol: wasAsset } },
    });
    const held = current ? Number(current.amount) : 0;
    const reversal = Math.min(held, wasAmount);

    if (current) {
      await tx.balance.update({
        where: { userId_symbol: { userId, symbol: wasAsset } },
        data: { amount: { decrement: new Prisma.Decimal(reversal) } },
      });
    }

    // Credit what actually settled.
    await tx.balance.upsert({
      where: { userId_symbol: { userId, symbol: targetAsset } },
      create: {
        userId,
        symbol: targetAsset,
        kind: kindOf(targetAsset),
        amount: new Prisma.Decimal(targetAmount),
      },
      update: { amount: { increment: new Prisma.Decimal(targetAmount) } },
    });

    // Keep the settlement row truthful.
    await tx.settlement.update({
      where: { id: settlementId },
      data: { asset: targetAsset, amount: new Prisma.Decimal(targetAmount) },
    });

    // Correct the user-visible transaction instead of leaving a wrong one.
    const original = await tx.transaction.findFirst({
      where: { userId, type: "deposit", meta: { path: ["externalId"], equals: s.externalId } },
    });
    // Resolve to a ticker here too, so the receipt reads "0.4 SOL" rather
    // than a 32-char mint address.
    const originAsset =
      (await resolveTokenSymbol(String(d.originAsset ?? ""), Number(d.originChainId) || undefined)) ?? null;
    const originAmount = num(d.originAmountFormatted);

    if (original) {
      await tx.transaction.update({
        where: { id: original.id },
        data: {
          assetOut: targetAsset,
          amountOut: new Prisma.Decimal(targetAmount),
          ...(originAsset && originAmount && originAsset !== targetAsset
            ? { assetIn: originAsset, amountIn: new Prisma.Decimal(originAmount) }
            : {}),
          note:
            originAsset && originAmount && originAsset !== targetAsset
              ? `Received ${originAmount} ${originAsset} — settled as ${targetAmount} ${targetAsset} (corrected)`
              : `Received ${targetAmount} ${targetAsset} (corrected)`,
          meta: {
            ...((original.meta ?? {}) as Record<string, unknown>),
            correctedAt: new Date().toISOString(),
            correctedBy: actorEmail,
            correctedFrom: { asset: wasAsset, amount: wasAmount },
            correctionReason: "origin/settlement asset mix-up",
          },
        },
      });
    }

    // Audit row — the correction is itself a visible event.
    await tx.transaction.create({
      data: {
        userId,
        type: "deposit",
        status: "completed",
        assetOut: targetAsset,
        amountOut: new Prisma.Decimal(targetAmount),
        assetIn: wasAsset,
        amountIn: new Prisma.Decimal(reversal),
        counterparty: "Correction",
        note: `Deposit ${s.externalId} re-settled: was ${wasAmount} ${wasAsset}, correct value ${targetAmount} ${targetAsset}`,
        emoji: "🛠️",
        meta: {
          kind: "deposit-correction",
          externalId: s.externalId,
          settlementId,
          wasAsset,
          wasAmount,
          reversed: reversal,
          nowAsset: targetAsset,
          nowAmount: targetAmount,
          manual: Boolean(manual),
          correctedBy: actorEmail,
        },
      },
    });
  });

  return {
    ok: true,
    from: { asset: wasAsset, amount: wasAmount },
    to: { asset: targetAsset, amount: targetAmount },
  };
}
