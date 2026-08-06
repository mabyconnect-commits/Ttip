import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { convert } from "../prices";
import { adjustTreasury, treasuryBalance } from "./treasury";
import { bybitConfig, bybitDepositAddress, bybitEnabled } from "./bybit";
import { sendSolanaUsdc, isPreBroadcast } from "./solana";

/**
 * Topping the naira float up when a payout is bigger than it.
 *
 * Someone sends $10,000 worth of USDT to a Nigerian bank. Their crypto is real
 * and their balance covers it — what doesn't cover it is OUR naira at the
 * payout provider. The old behaviour was to hand it over anyway and let the
 * provider reject it, which reads to the user as their transfer failing for no
 * reason they can see.
 *
 * Instead: raise the naira. Treasury USDC goes to the exchange, is sold for
 * naira, and the float is credited — at which point the held payout goes out on
 * its own.
 *
 * Two decisions worth stating:
 *
 *  - We raise MORE than the shortfall. A quote moves between sizing the trade
 *    and filling it, and coming back 2% short means doing the whole thing again
 *    while a user waits. The buffer is FLOAT_TOPUP_BUFFER_PCT, default 10%.
 *
 *  - The on-chain leg happens BEFORE anyone is asked to do anything. The slow
 *    part of this is a human finishing a P2P sell; the USDC should already be
 *    sitting on the exchange when they look, not waiting on them to start it.
 */

/**
 * How much extra to raise, so a moving rate can't leave us short.
 *
 * An UNSET variable is an empty string, and Number("") is 0 — which would
 * silently mean "no buffer at all" for anyone who added the key and left it
 * blank. Blank means unset here, as it should everywhere.
 */
export function topupBuffer(): number {
  const raw = (process.env.FLOAT_TOPUP_BUFFER_PCT ?? "").trim();
  const n = Number(raw);
  return raw !== "" && Number.isFinite(n) && n >= 0 && n < 1 ? n : 0.1;
}

/**
 * How long a held payout waits for the float before it fails and refunds.
 *
 * Bounded on both sides on purpose. Zero would expire every payout the instant
 * it was held — refunding people who were seconds from being paid — and a
 * window measured in days is a transfer nobody is coming back for.
 */
export function holdWindowMs(): number {
  const raw = (process.env.PAYOUT_HOLD_MINUTES ?? "").trim();
  const n = Number(raw);
  const minutes = raw !== "" && Number.isFinite(n) && n >= 1 && n <= 240 ? n : 20;
  return minutes * 60_000;
}

export function holdWindowMinutes(): number {
  return Math.round(holdWindowMs() / 60_000);
}

/** What the treasury sends to the exchange. Solana USDC — the rail we sign for. */
const SETTLE_ASSET = "USDC";

export interface RaiseResult {
  jobId: string;
  status: string;
  amountAsset: number;
  targetFiat: number;
  fundingTx?: string;
  message: string;
}

/**
 * Raise `shortfallFiat` (plus the buffer) by moving treasury USDC to the venue.
 *
 * Never throws: a top-up that can't start must still leave a row explaining
 * why, because the payout it was raised for is sitting in a queue waiting on
 * exactly this answer.
 */
export async function raiseFloat(
  fiat: string,
  shortfallFiat: number,
  reference?: string,
): Promise<RaiseResult> {
  const targetFiat = shortfallFiat * (1 + topupBuffer());
  const rate = await convert(1, SETTLE_ASSET, fiat).catch(() => 0);
  const amountAsset = rate > 0 ? targetFiat / rate : 0;

  const job = await prisma.liquidityJob.create({
    data: {
      provider: bybitEnabled() ? "bybit" : "manual",
      status: "created",
      fiat,
      targetFiat: new Prisma.Decimal(targetFiat),
      asset: SETTLE_ASSET,
      amountAsset: new Prisma.Decimal(amountAsset > 0 ? amountAsset : 0),
      reference: reference ?? null,
    },
  });

  const fail = async (message: string): Promise<RaiseResult> => {
    console.error(`[float] top-up ${job.id} could not start: ${message}`);
    await prisma.liquidityJob.update({ where: { id: job.id }, data: { status: "failed", error: message } });
    return { jobId: job.id, status: "failed", amountAsset, targetFiat, message };
  };

  if (!(amountAsset > 0)) return fail(`No ${SETTLE_ASSET}/${fiat} rate, so the top-up couldn't be sized.`);

  const held = await treasuryBalance(SETTLE_ASSET);
  if (held + 1e-9 < amountAsset) {
    return fail(
      `Treasury holds ${held.toFixed(2)} ${SETTLE_ASSET} but ${amountAsset.toFixed(2)} is needed. Fund the treasury.`,
    );
  }

  if (!bybitEnabled()) {
    return fail("Bybit isn't configured (BYBIT_API_KEY / BYBIT_API_SECRET), so nothing could be sent.");
  }

  const deposit = await bybitDepositAddress();
  if (!deposit) return fail("Bybit didn't return a deposit address.");

  await prisma.liquidityJob.update({
    where: { id: job.id },
    data: { status: "funding", depositAddress: deposit.address },
  });

  // The one money-moving step. Same signer, same guards, same distinction
  // between "nothing was sent" and "we can't be sure" as every other send.
  let fundingTx: string;
  try {
    const sent = await sendSolanaUsdc({ toAddress: deposit.address, amount: amountAsset });
    fundingTx = sent.txHash;
  } catch (e) {
    const message = (e as Error).message || "Funding failed";
    if (isPreBroadcast(e)) return fail(message);
    // Ambiguous: it may have broadcast. Leave it visible rather than calling it
    // failed, or an operator tops up twice against one shortfall.
    await prisma.liquidityJob.update({
      where: { id: job.id },
      data: { status: "funding", error: `Unconfirmed: ${message}` },
    });
    console.error(`[float] top-up ${job.id} funding unconfirmed: ${message}`);
    return {
      jobId: job.id,
      status: "funding",
      amountAsset,
      targetFiat,
      message: `Funding unconfirmed — check the treasury wallet before sending more. ${message}`,
    };
  }

  // The treasury's crypto has left. Record it now, not when the sell finishes,
  // or the ledger says we still hold coins that are on an exchange.
  await prisma.$transaction(async (tx) => {
    await adjustTreasury(tx, SETTLE_ASSET, -amountAsset);
  });

  await prisma.liquidityJob.update({ where: { id: job.id }, data: { status: "funded", fundingTx } });

  return {
    jobId: job.id,
    status: "funded",
    amountAsset,
    targetFiat,
    fundingTx,
    message:
      `${amountAsset.toFixed(2)} ${SETTLE_ASSET} sent to Bybit. ` +
      `Sell it for ${fiat} and mark the float topped up to release the payout.`,
  };
}

/**
 * An operator finished the sell: credit the float with what actually landed.
 *
 * The figure is theirs, not ours — we asked for a target and the market gave
 * them a number, and the float has to match the naira that genuinely exists or
 * every later shortfall calculation is built on a guess.
 */
export async function completeTopUp(jobId: string, raisedFiat: number): Promise<boolean> {
  const job = await prisma.liquidityJob.findUnique({ where: { id: jobId } });
  if (!job || job.status === "completed" || job.status === "failed") return false;

  await prisma.$transaction(async (tx) => {
    await adjustTreasury(tx, job.fiat, raisedFiat);
    await tx.liquidityJob.update({
      where: { id: jobId },
      data: { status: "completed", raisedFiat: new Prisma.Decimal(raisedFiat) },
    });
    await tx.settlement.create({
      data: {
        userId: null,
        kind: "liquidation",
        provider: job.provider,
        externalId: `topup_${jobId}`,
        status: "completed",
        asset: job.asset,
        amount: job.amountAsset,
        raw: { fiat: job.fiat, raisedFiat, fundingTx: job.fundingTx } as Prisma.InputJsonValue,
      },
    });
  });
  return true;
}

/** Jobs an operator still has something to do about. */
export async function openTopUps() {
  return prisma.liquidityJob.findMany({
    where: { status: { in: ["created", "funding", "funded"] } },
    orderBy: { createdAt: "asc" },
    take: 25,
  });
}

/** The venue we'd use, for the admin panel to show without guessing. */
export function settleVenue(): { name: string; coin: string; chain: string } | null {
  const cfg = bybitConfig();
  return cfg ? { name: "bybit", coin: cfg.coin, chain: cfg.chain } : null;
}
