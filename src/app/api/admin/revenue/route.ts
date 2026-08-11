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
 *   fiat deposits     deposit.meta.fee                collection cost + markup
 *   sell spread       withdraw_bank.meta.spreadFiat   margin on crypto -> fiat
 *   swaps             swap.meta.feePct + amountOut    the 0.5% after free swaps
 *   swap spread       swap.meta.spreadFiat            margin on a crypto<->fiat swap
 *   crypto withdrawals withdraw_wallet.meta.fee       the flat withdrawal fee
 *   buy spread        settlement.raw.spreadFiat       margin on fiat -> crypto
 *   gift cards        giftcard.meta.fee               our markup over the distributor's price
 *
 * CRYPTO deposits are absent: Ttip charges nothing to receive crypto. FIAT
 * deposits do carry a fee — the provider bills us to collect them.
 *
 * Referral commission, cashback and the first-deposit bonus are costs, not
 * revenue — reported separately and subtracted to give the net.
 *
 * NOTE ON HISTORY: swaps only began recording `spreadFiat` from the commit that
 * added this line. Swaps before it show no spread even though the margin was
 * taken and the referrer was paid a share of it, so any all-time net that spans
 * that date understates revenue. Windowed figures (30d/7d) become correct as
 * soon as the window clears the change.
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
/**
 * A single row is not allowed to destroy the whole report.
 *
 * A mis-credited deposit — raw base units written in as a real amount — made
 * total volume read $10,281,099,150,000,038,000. Every other figure on the page
 * became unreadable next to it, which is the opposite of what a dashboard is
 * for: the one bad row hid the ninety good ones.
 *
 * So a line worth more than this is left out of the totals and counted
 * separately, and the response says how many were dropped. Excluding it quietly
 * would be worse than the bad number — the operator has to know the report is
 * incomplete and why. Overridable if the platform ever legitimately moves this
 * much in one transaction.
 */
function sanityCapUsd(): number {
  const raw = (process.env.ADMIN_MAX_TXN_USD ?? "").trim();
  const n = Number(raw);
  return raw !== "" && Number.isFinite(n) && n > 0 ? n : 10_000_000;
}

function usdConverter() {
  const cache = new Map<string, number>();
  const cap = sanityCapUsd();
  let dropped = 0;
  const convert = async (amount: number, symbol: string): Promise<number> => {
    if (!(amount > 0) || !symbol) return 0;
    let unit = cache.get(symbol);
    if (unit === undefined) {
      unit = await toUsd(1, symbol);
      cache.set(symbol, unit);
    }
    const value = amount * unit;
    if (!Number.isFinite(value) || value > cap) {
      dropped++;
      return 0;
    }
    return value;
  };
  convert.droppedCount = () => dropped;
  return convert;
}

type Meta = {
  fee?: number;
  spreadFiat?: number;
  spreadFiatCurrency?: string;
  feeCurrency?: string;
  feePct?: number;
  grossFiat?: number;
  costFiat?: number;
} | null;

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
  let depositFees = 0;
  let billFees = 0;
  let sellSpread = 0;
  let swapFees = 0;
  let swapSpread = 0;
  let cryptoWithdrawalFees = 0;
  let referralPaid = 0;
  let cashbackPaid = 0;
  let depositBonusPaid = 0;
  let giftCardFees = 0;
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
        // A crypto↔fiat swap charges no swap fee — the margin IS the rate. That
        // spread is the single largest revenue line and was invisible here until
        // the swap started recording it.
        if (meta?.spreadFiat) {
          swapSpread += await usd(meta.spreadFiat, meta.spreadFiatCurrency ?? t.assetOut ?? "NGN");
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
      // The flat first-deposit bonus. Unlike referral commission and cashback
      // this is not a share of anything we earned — it is money given away to
      // win the user, and it was missing from the cost side entirely.
      case "deposit_bonus":
        depositBonusPaid += await usd(Number(t.amountOut ?? 0), t.assetOut ?? "NGN");
        break;
      // Fiat deposits: the provider's collection cost plus our markup, taken
      // out before the balance is credited.
      case "deposit": {
        const cur = t.assetOut ?? "NGN";
        if (meta?.fee) depositFees += await usd(meta.fee, cur);
        volume += await usd(Number(t.amountOut ?? 0), cur);
        break;
      }
      // Bill service fee, charged on top of the face value the biller receives.
      case "bill": {
        const cur = t.assetOut ?? "NGN";
        if (meta?.fee) billFees += await usd(meta.fee, meta.feeCurrency ?? cur);
        volume += await usd(Number(t.amountOut ?? t.amountIn ?? 0), cur);
        break;
      }
      // Gift cards: the distributor sells us face value at a discount and the
      // markup we add on top is the whole margin. A failed order is refunded in
      // full, so only the ones that completed count.
      case "giftcard": {
        // Only delivered orders reach here — the query above is completed-only,
        // and a refunded order is left at failed.
        const cur = meta?.feeCurrency ?? "NGN";
        if (meta?.fee) giftCardFees += await usd(meta.fee, cur);
        volume += await usd(meta?.costFiat ?? 0, cur);
        break;
      }
      case "buy":
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

  const feeTotal =
    bankTransferFees +
    depositFees +
    billFees +
    swapFees +
    swapSpread +
    cryptoWithdrawalFees +
    buySpread +
    sellSpread +
    giftCardFees;
  const rewardsTotal = referralPaid + cashbackPaid + depositBonusPaid;

  return NextResponse.json({
    window: since ? `last ${days} days` : "all time",
    fees: {
      bankTransfers: bankTransferFees,
      fiatDeposits: depositFees,
      bills: billFees,
      swaps: swapFees,
      swapSpread,
      cryptoWithdrawals: cryptoWithdrawalFees,
      buySpread,
      sellSpread,
      giftCards: giftCardFees,
      // Ttip doesn't charge to receive crypto, so there is no deposit fee.
      cryptoDeposits: 0,
      total: feeTotal,
    },
    rewards: {
      referralCommission: referralPaid,
      cashback: cashbackPaid,
      depositBonus: depositBonusPaid,
      total: rewardsTotal,
    },
    netRevenue: feeTotal - rewardsTotal,
    volume,
    // Lines left out of every figure above because they were too large to be
    // real — almost always a mis-credit. Non-zero means this report is
    // incomplete, and the Clean-up desk is where those get reversed.
    excludedAsImplausible: usd.droppedCount(),
    currency: "USD",
    note: "Computed from the fee recorded on each transaction at the time it happened, not from today's rates.",
  });
}
