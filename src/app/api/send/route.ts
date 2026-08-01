import crypto from "crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized, ApiError } from "@/lib/api";
import { getAppState } from "@/lib/serialize";
import { convert, isCrypto } from "@/lib/prices";
import { adjust, balanceOf } from "@/lib/wallet";
import { NETWORK_FEE_USDT } from "@/lib/constants";
import { dayStr, isYesterday } from "@/lib/format";
import { payoutFiat, finalizePayout, isLive } from "@/lib/settlement";

const schema = z.object({
  mode: z.enum(["ttip", "wallet", "bank"]),
  // ttip
  recipient: z.string().optional(), // @username or handle
  fiat: z.string().optional(), // fiat the amount is denominated in
  fiatAmount: z.number().positive().optional(),
  fundingSymbol: z.string().optional(), // crypto paid from
  note: z.string().max(140).optional(),
  emoji: z.string().max(8).optional(),
  // wallet
  symbol: z.string().optional(),
  amount: z.number().positive().optional(),
  address: z.string().optional(),
  network: z.string().optional(),
  // bank
  bankName: z.string().optional(),
  accountNumber: z.string().optional(),
  accountName: z.string().optional(),
});

export async function POST(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return unauthorized();

    const input = schema.parse(await req.json());

    if (input.mode === "ttip") {
      return handleTtip(userId, user, input);
    }
    if (input.mode === "wallet") {
      return handleWalletSend(userId, input);
    }
    return handleBankSend(userId, user, input);
  });
}

async function handleTtip(
  userId: string,
  user: { name: string; username: string; avatarGradient: string; bankAccount: string | null; streakDays: number; lastTipDay: string | null },
  input: z.infer<typeof schema>,
) {
  const fiat = input.fiat ?? "NGN";
  const fiatAmount = input.fiatAmount;
  const funding = input.fundingSymbol ?? "USDT";
  const recipientHandle = (input.recipient ?? "").trim().replace(/^@/, "").toLowerCase();
  if (!fiatAmount) throw new ApiError("Enter an amount", 400);
  if (!recipientHandle) throw new ApiError("Choose someone to Ttip", 400);
  if (recipientHandle === user.username.toLowerCase()) throw new ApiError("You can't Ttip yourself", 400);

  // Streak: increments once per day; continues if the last tip was yesterday,
  // resets to 1 if a day was missed, unchanged if already tipped today.
  const today = dayStr();
  const newStreak =
    user.lastTipDay === today ? user.streakDays
    : user.lastTipDay && isYesterday(user.lastTipDay) ? user.streakDays + 1
    : 1;

  // cost to sender in their funding asset
  const cost = await convert(fiatAmount, fiat, funding);
  const bal = await balanceOf(userId, funding);
  if (bal + 1e-12 < cost) throw new ApiError(`Not enough ${funding} to cover this tip`, 400);

  const recipient = await prisma.user.findUnique({ where: { username: recipientHandle } });

  const out = await prisma.$transaction(async (tx) => {
    await adjust(tx, userId, funding, -cost);

    if (recipient) {
      // recipient receives their default fiat
      const recvFiat = recipient.defaultFiat;
      const recvAmount = await convert(fiatAmount, fiat, recvFiat);
      await adjust(tx, recipient.id, recvFiat, recvAmount);
      await tx.transaction.create({
        data: {
          userId: recipient.id,
          type: "ttip_in",
          assetOut: recvFiat,
          amountOut: new Prisma.Decimal(recvAmount),
          counterparty: "@" + user.username,
          note: input.note,
          emoji: input.emoji ?? "⚡",
        },
      });
      await tx.user.update({ where: { id: recipient.id }, data: { points: { increment: 40 } } });
    }

    await tx.transaction.create({
      data: {
        userId,
        type: "ttip_out",
        assetIn: funding,
        amountIn: new Prisma.Decimal(cost),
        assetOut: fiat,
        amountOut: new Prisma.Decimal(fiatAmount),
        counterparty: "@" + recipientHandle,
        note: input.note,
        emoji: input.emoji ?? "⚡",
        status: recipient ? "completed" : "pending",
        meta: { external: !recipient },
      },
    });

    await tx.user.update({
      where: { id: userId },
      data: { points: { increment: 120 }, streakDays: newStreak, lastTipDay: today },
    });

    await tx.feedItem.create({
      data: {
        actorId: userId,
        kind: "tip",
        actorName: "@" + user.username,
        targetName: "@" + recipientHandle,
        amount: new Prisma.Decimal(fiatAmount),
        currency: fiat,
        note: input.note,
        emoji: input.emoji ?? "⚡",
      },
    });
  });
  void out;

  const state = await getAppState(userId);
  return ok({
    ...state,
    receipt: {
      kind: "ttip",
      recipient: "@" + recipientHandle,
      fiat,
      fiatAmount,
      funding,
      cost,
      delivered: !!recipient,
      note: input.note,
      emoji: input.emoji ?? "⚡",
    },
  });
}

async function handleWalletSend(userId: string, input: z.infer<typeof schema>) {
  const symbol = input.symbol;
  const amount = input.amount;
  if (!symbol || !amount) throw new ApiError("Enter an amount", 400);
  if (!isCrypto(symbol)) throw new ApiError("Only crypto can be sent to a wallet", 400);
  if (!input.address || input.address.length < 8) throw new ApiError("Enter a valid wallet address", 400);

  // network fee expressed in the sent asset
  const feeInAsset = await convert(NETWORK_FEE_USDT, "USDT", symbol);
  const total = amount + feeInAsset;
  const bal = await balanceOf(userId, symbol);
  if (bal + 1e-12 < total) throw new ApiError(`Insufficient ${symbol} to cover amount + network fee`, 400);

  await prisma.$transaction(async (tx) => {
    await adjust(tx, userId, symbol, -total);
    await tx.transaction.create({
      data: {
        userId,
        type: "withdraw_wallet",
        assetIn: symbol,
        amountIn: new Prisma.Decimal(amount),
        counterparty: input.address,
        note: `Sent ${symbol} on ${input.network ?? "network"}`,
        emoji: "🔗",
        status: "completed",
        meta: { network: input.network, fee: feeInAsset },
      },
    });
  });

  const state = await getAppState(userId);
  return ok({
    ...state,
    receipt: { kind: "wallet", symbol, amount, address: input.address, network: input.network, fee: feeInAsset },
  });
}

async function handleBankSend(
  userId: string,
  user: { bankName: string | null },
  input: z.infer<typeof schema>,
) {
  const symbol = input.symbol ?? "USDT";
  const amount = input.amount;
  const fiat = input.fiat ?? "NGN";
  if (!amount) throw new ApiError("Enter an amount", 400);
  if (!input.accountNumber || input.accountNumber.length < 6) throw new ApiError("Enter a valid account number", 400);
  const accountNumber = input.accountNumber;

  const bal = await balanceOf(userId, symbol);
  if (bal + 1e-12 < amount) throw new ApiError(`Insufficient ${symbol} balance`, 400);
  const fiatAmount = await convert(amount, symbol, fiat);
  const bankLabel = `${input.bankName ?? user.bankName ?? "Bank"} ••${accountNumber.slice(-4)}`;
  const reference = "pyt_" + crypto.randomUUID();
  const provider = isLive() ? "flutterwave" : "sandbox";

  // 1. Debit the crypto and record the payout as pending — one atomic step, so
  //    the money can never leave the wallet without a settlement row to match it.
  await prisma.$transaction(async (tx) => {
    await adjust(tx, userId, symbol, -amount);
    await tx.transaction.create({
      data: {
        userId,
        type: "withdraw_bank",
        assetIn: symbol,
        amountIn: new Prisma.Decimal(amount),
        assetOut: fiat,
        amountOut: new Prisma.Decimal(fiatAmount),
        counterparty: bankLabel,
        note: input.accountName ? `To ${input.accountName}` : "Bank payout",
        emoji: "🏦",
        status: "pending",
        meta: { reference, provider, network: "bank" },
      },
    });
    await tx.settlement.create({
      data: {
        userId,
        kind: "payout",
        provider,
        externalId: reference,
        reference,
        status: "pending",
        asset: fiat,
        amount: new Prisma.Decimal(fiatAmount),
        address: accountNumber,
      },
    });
  });

  // 2. Ask the provider to move the fiat. Sandbox settles instantly; Flutterwave
  //    may return "pending" and confirm later via /api/webhooks/payout.
  let payoutStatus: "pending" | "completed" | "failed" = "pending";
  try {
    const result = await payoutFiat({
      userId,
      amountFiat: fiatAmount,
      currency: fiat,
      accountNumber,
      bankName: input.bankName ?? user.bankName ?? undefined,
      accountName: input.accountName,
      narration: "Ttip payout",
      reference,
    });
    payoutStatus = result.status;
  } catch {
    payoutStatus = "failed";
  }

  // 3. Reconcile: a terminal result finalizes now (refunding on failure); a
  //    pending result waits for the provider webhook.
  if (payoutStatus === "completed" || payoutStatus === "failed") {
    await finalizePayout({ reference }, payoutStatus);
  }

  if (payoutStatus === "failed") {
    // finalizePayout has refunded the debited crypto.
    throw new ApiError("Payout could not be sent — your balance was not charged.", 502);
  }

  const state = await getAppState(userId);
  return ok({
    ...state,
    receipt: {
      kind: "bank",
      symbol,
      amount,
      fiat,
      fiatAmount,
      bank: bankLabel,
      status: payoutStatus, // "completed" (sandbox) or "pending" (live, awaiting webhook)
    },
  });
}
