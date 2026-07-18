import { prisma } from "./db";
import { buildPortfolio } from "./wallet";
import { dayStr } from "./format";

const FREE_SWAPS_PER_DAY = 3;

/** Full app-state payload the client needs after auth. */
export async function getAppState(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { balances: true, card: true, addresses: true },
  });
  if (!user) return null;

  const portfolio = await buildPortfolio(user.balances, user.defaultFiat);

  // Free-swap allowance is per-day; show the full amount on a fresh day.
  const freeSwapsLeft = user.freeSwapDay === dayStr() ? user.freeSwapsLeft : FREE_SWAPS_PER_DAY;

  return {
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      name: user.name,
      verified: user.verified,
      avatarGradient: user.avatarGradient,
      defaultFiat: user.defaultFiat,
      bankName: user.bankName,
      bankAccount: user.bankAccount,
      streakDays: user.streakDays,
      points: user.points,
      freeSwapsLeft,
      referralCode: user.referralCode,
      referralEarned: Number(user.referralEarned),
      hasPin: !!user.pinHash,
      kycStatus: user.kycStatus,
      kycTier: user.kycTier,
      initial: user.name.trim().charAt(0).toUpperCase(),
    },
    portfolio,
    card: user.card
      ? {
          last4: user.card.last4,
          holder: user.card.holder,
          balanceUsd: Number(user.card.balanceUsd),
          frozen: user.card.frozen,
          exp: `${String(user.card.expMonth).padStart(2, "0")}/${String(user.card.expYear).slice(-2)}`,
        }
      : null,
  };
}

export type AppState = NonNullable<Awaited<ReturnType<typeof getAppState>>>;
