import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { kindOf } from "../wallet";
import { convert } from "../prices";
import { liquidityProvider } from "./liquidity";

/**
 * Treasury — the platform's own money. Crypto swept from user deposits lands
 * here; fiat payouts are drawn from the float here. When a payout exceeds the
 * float, ensureFloat() auto-sells treasury crypto into the float so the payout
 * can still go out immediately.
 */

type Tx = Prisma.TransactionClient;

export async function treasuryBalance(symbol: string, client: Tx | typeof prisma = prisma): Promise<number> {
  const b = await client.treasuryBalance.findUnique({ where: { symbol } });
  return b ? Number(b.amount) : 0;
}

/** Add `amount` (may be negative) to a treasury balance, creating it if needed. */
export async function adjustTreasury(tx: Tx, symbol: string, amount: number): Promise<void> {
  await tx.treasuryBalance.upsert({
    where: { symbol },
    create: { symbol, kind: kindOf(symbol), amount: new Prisma.Decimal(amount) },
    update: { amount: { increment: amount } },
  });
}

export interface EnsureFloatResult {
  floatBefore: number;
  liquidated: boolean;
  soldAsset?: string;
  soldAmount?: number;
  raisedFiat?: number;
  shortfall?: number; // remaining uncovered fiat, if treasury crypto ran out
}

/**
 * Guarantee the `fiat` float can cover `amountFiat`. If it can't, sell treasury
 * crypto (default USDT) at the live rate to top the float up. Returns what
 * happened; `shortfall > 0` means even after liquidating all treasury crypto the
 * float still can't cover it (caller should not pay out instantly).
 */
export async function ensureFloat(
  fiat: string,
  amountFiat: number,
  opts: { preferAsset?: string } = {},
): Promise<EnsureFloatResult> {
  const floatBefore = await treasuryBalance(fiat);
  if (floatBefore + 1e-9 >= amountFiat) return { floatBefore, liquidated: false };

  const asset = opts.preferAsset ?? "USDT";
  const shortfallFiat = amountFiat - floatBefore;

  // How much crypto covers the shortfall at the live rate — capped by holdings.
  const rate = await convert(1, asset, fiat); // fiat per 1 unit of asset
  const held = await treasuryBalance(asset);
  const needAsset = rate > 0 ? shortfallFiat / rate : 0;
  const sell = Math.min(needAsset, held);

  if (sell <= 0) {
    return { floatBefore, liquidated: false, shortfall: shortfallFiat };
  }

  const provider = liquidityProvider();
  const quote = await provider.quote(asset, fiat, sell);
  const exec = await provider.execute(quote);

  await prisma.$transaction(async (tx) => {
    await adjustTreasury(tx, asset, -sell);
    await adjustTreasury(tx, fiat, exec.amountFiat);
    await tx.settlement.create({
      data: {
        userId: null,
        kind: "liquidation",
        provider: provider.name,
        externalId: exec.ref,
        status: "completed",
        asset,
        amount: new Prisma.Decimal(sell),
        raw: { fiat, raisedFiat: exec.amountFiat, rate: quote.rate } as Prisma.InputJsonValue,
      },
    });
  });

  const raised = exec.amountFiat;
  const covered = floatBefore + raised;
  return {
    floatBefore,
    liquidated: true,
    soldAsset: asset,
    soldAmount: sell,
    raisedFiat: raised,
    shortfall: covered + 1e-9 >= amountFiat ? undefined : amountFiat - covered,
  };
}

/** Draw `amount` fiat out of the float once a payout is actually sent. */
export async function debitFloat(tx: Tx, fiat: string, amount: number): Promise<void> {
  await adjustTreasury(tx, fiat, -amount);
}
