import { prisma } from "./db";
import { buildPortfolio } from "./wallet";
import { dayStr } from "./format";
import { settlementStatus } from "./settlement/config";
import { maybePayDepositBonus } from "./referral";
import { cashbackMinClaim } from "./cashback";
import { rewardsRate } from "./rewards";

const FREE_SWAPS_PER_DAY = 3;

/** Full app-state payload the client needs after auth. */
export async function getAppState(userId: string) {
  // Self-healing rewards: pay the first-deposit bonus if it's now due (72h hold).
  // Cheap no-op for anyone who isn't eligible; never throws.
  await maybePayDepositBonus(userId);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { balances: true, card: true, addresses: true },
  });
  if (!user) return null;

  const portfolio = await buildPortfolio(user.balances, user.defaultFiat);

  // Free-swap allowance is per-day; show the full amount on a fresh day.
  const freeSwapsLeft = user.freeSwapDay === dayStr() ? user.freeSwapsLeft : FREE_SWAPS_PER_DAY;

  // The reward pots are stored in the base fiat; convert them — and the claim
  // threshold — into the user's display currency at the same rate, so the
  // progress bar and the claim gate stay in step with what the server will pay.
  const rate = await rewardsRate(user.defaultFiat);
  const cashback = Number(user.cashback) * rate;
  const cashbackMin = cashbackMinClaim() * rate;

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
      // Left in REWARDS_BASE_FIAT to match /api/referrals and the referrals
      // screen, which both label this pot in the base currency.
      referralEarned: Number(user.referralEarned),
      cashback,
      cashbackMin,
      hasPin: !!user.pinHash,
      kycStatus: user.kycStatus,
      kycTier: user.kycTier,
      nairaAccount: user.nairaAccount,
      nairaBank: user.nairaBank,
      initial: user.name.trim().charAt(0).toUpperCase(),
      // Drives the admin link only. Every admin API re-checks server-side, so
      // flipping this in the client grants nothing.
      isAdmin: (process.env.ADMIN_EMAILS ?? process.env.ADMIN_MAILS ?? "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
        .includes(user.email.toLowerCase()),
    },
    portfolio,
    // Runtime money mode, so the UI can flag test mode and never imply real
    // money is moving when it isn't. "live" | "demo" | "disabled".
    config: { payments: settlementStatus() },
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
