import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized, ApiError } from "@/lib/api";
import { getAppState } from "@/lib/serialize";
import { convert, isCrypto } from "@/lib/prices";
import { adjust, balanceOf } from "@/lib/wallet";
import { dayStr } from "@/lib/format";
import { freeSwapsLeft, quoteSwap } from "@/lib/swap-math";
import { referenceRate } from "@/lib/rate";
import { quoteBuy, quoteSell } from "@/lib/pricing";
import { accrueCashback } from "@/lib/cashback";

const schema = z.object({
  fromSymbol: z.string(),
  toSymbol: z.string(),
  amount: z.number().positive("Enter an amount"), // always the "from" amount
  payoutToBank: z.boolean().optional(),
});

export async function POST(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();

    const { fromSymbol, toSymbol, amount, payoutToBank } = schema.parse(await req.json());
    if (fromSymbol === toSymbol) throw new ApiError("Pick two different assets", 400);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return unauthorized();

    const bal = await balanceOf(userId, fromSymbol);
    if (bal + 1e-12 < amount) throw new ApiError(`Insufficient ${fromSymbol} balance`, 400);

    // Free-swap allowance resets each day. If today is a new day, the user has
    // their full daily allowance again regardless of the stored counter.
    const today = dayStr();
    const freeLeft = freeSwapsLeft(user.freeSwapDay, user.freeSwapsLeft, today);

    // Price the swap. Crypto↔fiat legs use our official pricing engine (the same
    // buy/sell rate shown on the Rates page) so a swap never disagrees with our
    // quoted rate; the margin is baked into the rate — no separate swap fee, and
    // no free-swap allowance is consumed. Crypto↔crypto keeps the free/paid swap
    // model on top of the live market conversion.
    const cryptoFrom = isCrypto(fromSymbol);
    const cryptoTo = isCrypto(toSymbol);

    let net: number;
    let rate: number;
    let feePct = 0;
    let free = false; // whether a free-swap allowance was consumed
    let fiatVolume = 0; // naira value of the trade, for cashback
    let cashbackFiat = "";

    if (cryptoFrom && !cryptoTo) {
      // crypto → fiat (off-ramp): our sell rate, margin baked in.
      const marketRate = await referenceRate(fromSymbol, toSymbol);
      if (!(marketRate > 0)) throw new ApiError("Rate unavailable, try again", 503);
      const q = quoteSell({ asset: fromSymbol, fiat: toSymbol, amountAsset: amount, marketRate });
      net = q.userFiat;
      rate = amount > 0 ? net / amount : 0;
      fiatVolume = net;
      cashbackFiat = toSymbol;
    } else if (!cryptoFrom && cryptoTo) {
      // fiat → crypto (on-ramp): our buy rate, margin baked in.
      const marketRate = await referenceRate(toSymbol, fromSymbol);
      if (!(marketRate > 0)) throw new ApiError("Rate unavailable, try again", 503);
      const userRate = quoteBuy({ asset: toSymbol, fiat: fromSymbol, amountAsset: 1, marketRate }).userRate;
      net = userRate > 0 ? amount / userRate : 0;
      rate = amount > 0 ? net / amount : 0;
      fiatVolume = amount;
      cashbackFiat = fromSymbol;
    } else {
      // crypto → crypto (or fiat → fiat): live market convert with swap-fee model.
      const gross = await convert(amount, fromSymbol, toSymbol);
      const q = quoteSwap(amount, gross, freeLeft);
      net = q.net;
      rate = q.rate;
      feePct = q.feePct;
      free = q.free;
    }

    const result = await prisma.$transaction(async (tx) => {
      await adjust(tx, userId, fromSymbol, -amount);

      // If swapping crypto -> fiat with bank payout, the fiat leaves the wallet.
      const settledToBank = payoutToBank && !isCrypto(toSymbol);
      if (!settledToBank) {
        await adjust(tx, userId, toSymbol, net);
      }

      // Cashback on the naira volume of a crypto↔fiat swap (a buy or a sell).
      if (fiatVolume > 0 && cashbackFiat) {
        await accrueCashback(tx, userId, fiatVolume, {
          fiat: cashbackFiat,
          source: cryptoFrom ? "swap sell" : "swap buy",
        });
      }

      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          freeSwapsLeft: Math.max(0, freeLeft - (free ? 1 : 0)),
          freeSwapDay: today,
          points: { increment: 60 },
        },
      });

      const txn = await tx.transaction.create({
        data: {
          userId,
          type: "swap",
          assetIn: fromSymbol,
          amountIn: new Prisma.Decimal(amount),
          assetOut: toSymbol,
          amountOut: new Prisma.Decimal(net),
          counterparty: settledToBank ? user.bankAccount : "Ttip wallet",
          note: `Swapped ${fromSymbol} → ${toSymbol}`,
          emoji: "⇄",
          meta: { rate, feePct, settledToBank, free },
        },
      });
      return { updated, txn, settledToBank };
    });

    const state = await getAppState(userId);
    return ok({
      ...state,
      receipt: {
        kind: "swap",
        fromSymbol,
        toSymbol,
        amountIn: amount,
        amountOut: net,
        rate,
        feePct,
        free,
        settledToBank: result.settledToBank,
        destination: result.settledToBank ? user.bankAccount : "Ttip wallet",
        id: result.txn.id,
      },
    });
  });
}
