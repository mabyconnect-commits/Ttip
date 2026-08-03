import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { toUsd } from "@/lib/prices";

export const dynamic = "force-dynamic";

/**
 * Platform revenue, by segment. Read-only.
 *
 * Every figure is computed from what was actually recorded on each transaction
 * at the time it happened — never re-derived from today's fee table, so
 * changing a fee rate never rewrites history.
 *
 * Where each number comes from:
 *   bank transfers    withdraw_bank.meta.fee          the transfer fee charged
 *   sell spread       withdraw_bank.meta.spreadFiat   margin on crypto -> fiat
 *   swaps             swap.meta.feePct + amountOut    the 0.5% after free swaps
 *   crypto withdrawals withdraw_wallet.meta.fee       the flat withdrawal fee
 *   buy spread        settlement.raw.spreadFiat       margin on fiat -> crypto
 *
 * Deposits are deliberately absent: Ttip charges nothing to receive crypto, so
 * there is no deposit fee to report. Revenue on funded money is the buy spread.
 *
 * Referral commission and cashback are costs, not revenue — reported separately
 * and subtracted to give the net.
 *
 * Everything is converted to USD so segments in different currencies add up.
 */

async function isAdmin(userId: string): Promise<boolean> {
  const raw = process.env.ADMIN_EMAILS ?? process.env.ADMIN_MAILS ?? "";
  const admins = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!admins.length) return false;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return !!user && admins.includes(user.email.toLowerCase());
}

/** Cache FX/price lookups per symbol so one pass doesn't re-fetch per row. */
function usdConverter() {
  const cache = new Map<string, number>();
  return async (amount: number, symbol: string): Promise<number> => {
    if (!(amount > 0) || !symbol) return 0;
    let unit = cache.get(symbol);
    if (unit === undefined) {
      unit = await toUsd(1, symbol);
      cache.set(symbol, unit);
    }
    return amount * unit;
  };
}

type Meta = { fee?: number; spreadFiat?: number; feePct?: number; grossFiat?: number } | null;

export async function GET(req: Request) {
  const userId = await getUserId();
  if (!userId || !(await isAdmin(userId))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Optional window: ?days=30. Omitted = all time.
  const days = Number(new URL(req.url).searchParams.get("days"));
  const since = Number.isFinite(days) && days > 0 ? new Date(Date.now() - days * 864e5) : undefined;
  const when = since ? { createdAt: { gte: since } } : {};

  const usd = usdConverter();

  const txns = await prisma.transaction.findMany({
    where: { status: "completed", ...when },
    select: { type: true, assetIn: true, amountIn: true, assetOut: true, amountOut: true, meta: true },
  });

  let bankTransferFees = 0;
  let sellSpread = 0;
  let swapFees = 0;
  let cryptoWithdrawalFees = 0;
  let referralPaid = 0;
  let cashbackPaid = 0;
  let volume = 0;

  for (const t of txns) {
    const meta = t.meta as Meta;

    switch (t.type) {
      case "withdraw_bank": {
        // fee and spread are both denominated in the payout fiat (assetOut).
        const fiat = t.assetOut ?? "NGN";
        if (meta?.fee) bankTransferFees += await usd(meta.fee, fiat);
        if (meta?.spreadFiat) sellSpread += await usd(meta.spreadFiat, fiat);
        // Volume = the gross value that moved, before our cut.
        volume += await usd(meta?.grossFiat ?? Number(t.amountOut ?? 0), fiat);
        break;
      }
      case "swap": {
        const out = Number(t.amountOut ?? 0);
        const pct = meta?.feePct ?? 0;
        // net = gross * (1 - pct), so the fee we kept is gross - net.
        if (pct > 0 && pct < 1 && out > 0) {
          const gross = out / (1 - pct);
          swapFees += await usd(gross - out, t.assetOut ?? "USDT");
        }
        volume += await usd(out, t.assetOut ?? "USDT");
        break;
      }
      case "withdraw_wallet": {
        // The flat withdrawal fee, charged in the asset being sent.
        const asset = t.assetIn ?? "USDT";
        if (meta?.fee) cryptoWithdrawalFees += await usd(meta.fee, asset);
        volume += await usd(Number(t.amountIn ?? 0), asset);
        break;
      }
      case "referral_bonus":
        referralPaid += await usd(Number(t.amountOut ?? 0), t.assetOut ?? "NGN");
        break;
      case "cashback_earn":
        cashbackPaid += await usd(Number(t.amountOut ?? 0), t.assetOut ?? "NGN");
        break;
      case "buy":
      case "bill":
      case "ttip_out":
        volume += await usd(Number(t.amountOut ?? t.amountIn ?? 0), t.assetOut ?? t.assetIn ?? "NGN");
        break;
      default:
        break;
    }
  }

  // Buy spread lives on the settlement, not the transaction.
  const buys = await prisma.settlement.findMany({
    where: { kind: "buy", status: "completed", ...when },
    select: { raw: true },
  });
  let buySpread = 0;
  for (const b of buys) {
    const raw = b.raw as { spreadFiat?: number; fiat?: string } | null;
    if (raw?.spreadFiat) buySpread += await usd(raw.spreadFiat, raw.fiat ?? "NGN");
  }

  const feeTotal = bankTransferFees + swapFees + cryptoWithdrawalFees + buySpread + sellSpread;
  const rewardsTotal = referralPaid + cashbackPaid;

  return NextResponse.json({
    window: since ? `last ${days} days` : "all time",
    fees: {
      bankTransfers: bankTransferFees,
      swaps: swapFees,
      cryptoWithdrawals: cryptoWithdrawalFees,
      buySpread,
      sellSpread,
      // Ttip doesn't charge to receive crypto, so there is no deposit fee.
      cryptoDeposits: 0,
      total: feeTotal,
    },
    rewards: { referralCommission: referralPaid, cashback: cashbackPaid, total: rewardsTotal },
    netRevenue: feeTotal - rewardsTotal,
    volume,
    currency: "USD",
    note: "Computed from the fee recorded on each transaction at the time it happened, not from today's rates.",
  });
}
