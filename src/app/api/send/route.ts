import crypto from "crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized, ApiError } from "@/lib/api";
import { getAppState } from "@/lib/serialize";
import { convert, isCrypto } from "@/lib/prices";
import { adjust, balanceOf } from "@/lib/wallet";
import { WITHDRAW_FEE_USDT } from "@/lib/constants";
import { dayStr, isYesterday } from "@/lib/format";
import { payoutFiat, finalizePayout, payoutProvider, ensureFloat, debitFloat, cryptoWithdraw, settlementEnabled, demoEnabled, solanaWithdrawSupported, isValidSolanaAddress, maxCryptoWithdrawal, dextopusWithdrawEnabled, dextopusWithdrawPreview } from "@/lib/settlement";
import { chainIdForNetwork } from "@/lib/chains";
import { quoteSell, transferFee } from "@/lib/pricing";
import { referenceFiat } from "@/lib/rate";
import { accrueCashback } from "@/lib/cashback";
import { checkWithdrawalLimit } from "@/lib/kyc/limits";
import { accrueReferralEarning } from "@/lib/referral";

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
  chainId: z.number().optional(), // Dextopus destination chain id (dynamic picker)
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
    // Fail closed: withdrawals move real money — refuse unless live or demo.
    if (!settlementEnabled()) {
      throw new ApiError("Withdrawals aren't available yet. Please check back soon.", 503);
    }
    // Moving money off the platform requires a verified identity (BVN/NIN).
    // Email-only accounts can hold and receive, but cannot withdraw.
    if (user.kycStatus !== "verified") {
      throw new ApiError("Verify your identity (BVN) to withdraw. It takes about a minute under Account → Verify.", 403);
    }
    if (input.mode === "wallet") {
      return handleWalletSend(userId, user.kycTier, input);
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

async function handleWalletSend(userId: string, kycTier: number, input: z.infer<typeof schema>) {
  const symbol = input.symbol;
  const amount = input.amount;
  if (!symbol || !amount) throw new ApiError("Enter an amount", 400);
  if (!isCrypto(symbol)) throw new ApiError("Only crypto can be sent to a wallet", 400);
  if (!input.address || input.address.length < 8) throw new ApiError("Enter a valid wallet address", 400);

  // KYC tier limits apply to crypto leaving the platform too, valued in naira —
  // otherwise the bank limit would just be routed around via a wallet send.
  const sendNgn = await referenceFiat(amount, symbol, "NGN");
  const walletLimit = await checkWithdrawalLimit(userId, kycTier, sendNgn, "NGN");
  if (!walletLimit.ok) throw new ApiError(walletLimit.reason ?? "Withdrawal limit reached", 403);

  // Live sends: USDC on Solana goes out via the built-in treasury signer;
  // everything else goes cross-chain via Dextopus (treasury USDC → the user's
  // asset on their chain). Demo always simulates. If neither rail is available it
  // fails closed so no funds get stuck as pending.
  const liveOnChain = !demoEnabled(); // settlementEnabled() already true here → live
  // Destination chain: the dynamic picker sends an explicit chainId; fall back to
  // resolving the network label for older clients.
  const destChainId = input.chainId ?? chainIdForNetwork(input.network) ?? undefined;
  const isSolanaNet = /sol/i.test(input.network ?? "") || destChainId === 792703809;
  const solanaDirect = solanaWithdrawSupported(symbol) && isSolanaNet;
  const dexAvailable = dextopusWithdrawEnabled();
  if (liveOnChain && !solanaDirect && !dexAvailable) {
    throw new ApiError(`${symbol} withdrawal isn't available yet.`, 503);
  }

  let network = input.network;
  if (liveOnChain && solanaDirect) {
    // Real Solana send: validate the destination and enforce the hot-wallet cap.
    if (!isValidSolanaAddress(input.address)) throw new ApiError("Enter a valid Solana address.", 400);
    if (amount > maxCryptoWithdrawal()) {
      throw new ApiError(`Max withdrawal is ${maxCryptoWithdrawal()} ${symbol} for now — contact support for larger amounts.`, 400);
    }
    network = "Solana";
  } else if (liveOnChain && dexAvailable) {
    // Dextopus cross-chain send: enforce the cap, then dry-run the whole route
    // BEFORE debiting — catches unsupported assets (native coins), bad
    // addresses and below-minimum amounts with a clear message and no debit.
    if (!destChainId) throw new ApiError(`Choose a supported network for ${symbol}.`, 400);
    if (amount > maxCryptoWithdrawal()) {
      throw new ApiError(`Max withdrawal is ${maxCryptoWithdrawal()} ${symbol} for now — contact support for larger amounts.`, 400);
    }
    const preview = await dextopusWithdrawPreview({ asset: symbol, network: input.network, chainId: destChainId, address: input.address, amount, reference: "" });
    if (!preview.ok) throw new ApiError(preview.message ?? "This withdrawal can't be processed.", 400);
  }

  // network fee expressed in the sent asset
  const feeInAsset = await convert(WITHDRAW_FEE_USDT, "USDT", symbol);
  const total = amount + feeInAsset;
  const bal = await balanceOf(userId, symbol);
  if (bal + 1e-12 < total) throw new ApiError(`Insufficient ${symbol} to cover amount + network fee`, 400);

  const reference = "cwd_" + crypto.randomUUID();

  // Real withdrawal pipeline: atomic debit + pending settlement, then send.
  // Sandbox settles instantly with a simulated tx hash; live queues the
  // withdrawal as pending for the treasury signer (never a false "completed").
  let result;
  try {
    result = await cryptoWithdraw({
      userId,
      asset: symbol,
      amount,
      fee: feeInAsset,
      address: input.address,
      network,
      chainId: destChainId,
      reference,
    });
  } catch (e: any) {
    throw new ApiError(e.message ?? "Withdrawal failed", 502);
  }

  const state = await getAppState(userId);
  return ok({
    ...state,
    receipt: {
      kind: "wallet",
      symbol,
      amount,
      address: input.address,
      network,
      fee: feeInAsset,
      status: result.status, // "completed" (sandbox/solana) or "pending" (queued)
      txHash: result.txHash,
    },
  });
}

async function handleBankSend(
  userId: string,
  user: { bankName: string | null; kycTier: number },
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

  // Competitive pricing: the user is paid the live market rate minus our margin
  // when converting crypto → fiat; that spread is platform revenue. A same-fiat
  // withdrawal carries no spread.
  const marketFiat = await referenceFiat(amount, symbol, fiat);
  let grossFiat = marketFiat;
  let spreadFiat = 0;
  if (symbol !== fiat && isCrypto(symbol)) {
    const marketRate = amount > 0 ? marketFiat / amount : 0;
    const q = quoteSell({ asset: symbol, fiat, amountAsset: amount, marketRate });
    grossFiat = q.userFiat;
    spreadFiat = q.spreadFiat;
  }

  // Transfer fee (provider cost + markup), charged to the user like a bank fee.
  // The net amount is what actually lands in their bank. A currency we can't
  // price is refused outright — charging 0 would mean absorbing the provider's
  // fee on every withdrawal in that currency.
  const fee = transferFee(grossFiat, fiat);
  if (fee === null) {
    throw new ApiError(`Bank payouts in ${fiat} aren't supported yet — your balance was not charged.`, 400);
  }
  const fiatAmount = grossFiat - fee;
  if (fiatAmount <= 0) throw new ApiError("Amount is too small to cover the transfer fee", 400);

  // KYC tier limits — checked on the gross amount leaving the account.
  const limit = await checkWithdrawalLimit(userId, user.kycTier, grossFiat, fiat);
  if (!limit.ok) throw new ApiError(limit.reason ?? "Withdrawal limit reached", 403);

  const bankLabel = `${input.bankName ?? user.bankName ?? "Bank"} ••${accountNumber.slice(-4)}`;
  const reference = "pyt_" + crypto.randomUUID();
  const provider = payoutProvider();

  // Make sure the fiat float can cover this payout; if it's short, auto-sell
  // treasury crypto into the float so a large withdrawal still goes out now.
  await ensureFloat(fiat, fiatAmount);

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
        meta: { reference, provider, network: "bank", spreadFiat, marketFiat, fee, grossFiat },
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
        raw: { spreadFiat, marketFiat } as Prisma.InputJsonValue,
      },
    });
  });

  // 2. Ask the provider to move the fiat. Sandbox settles instantly; Flutterwave
  //    may return "pending" and confirm later via /api/webhooks/payout.
  let payoutStatus: "pending" | "completed" | "failed" = "pending";
  let providerMessage: string | undefined;
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
    providerMessage = result.message;
  } catch (e: any) {
    payoutStatus = "failed";
    providerMessage = e?.message;
  }

  // 3. Reconcile: a terminal result finalizes now (refunding on failure); a
  //    pending result waits for the provider webhook.
  if (payoutStatus === "completed" || payoutStatus === "failed") {
    await finalizePayout({ reference }, payoutStatus);
  }

  if (payoutStatus === "failed") {
    // finalizePayout has refunded the debited crypto. Lead with the provider's
    // reason so it's visible even in a short toast (balance was not charged).
    const base = providerMessage?.trim() || "Payout could not be sent";
    throw new ApiError(`${base} — balance not charged.`, 502);
  }

  // The fiat has left the float — draw it down, reward cashback on the sale, and
  // pay the referrer their share of the revenue (spread + transfer fee).
  if (payoutStatus === "completed") {
    await prisma.$transaction(async (tx) => {
      await debitFloat(tx, fiat, fiatAmount);
      await accrueCashback(tx, userId, grossFiat, { fiat, source: "cash out" });
      await accrueReferralEarning(tx, userId, spreadFiat + fee, { fiat, source: "cash out" });
    });
  }

  const state = await getAppState(userId);
  return ok({
    ...state,
    receipt: {
      kind: "bank",
      symbol,
      amount,
      fiat,
      fiatAmount, // net amount that lands in the bank
      grossFiat,
      fee,
      bank: bankLabel,
      status: payoutStatus, // "completed" (sandbox) or "pending" (live, awaiting webhook)
    },
  });
}
