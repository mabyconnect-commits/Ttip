import { prisma } from "./db";
import { buildPortfolio } from "./wallet";
import { dayStr } from "./format";
import { freeSwapsLeft } from "./swap-math";
import { settlementStatus } from "./settlement/config";
import { depositFeeScheduleFor } from "./pricing";
import { maybePayDepositBonus } from "./referral";
import { cashbackMinClaim } from "./cashback";
import { rewardsRate } from "./rewards";


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

  // "Opened the app", recorded once and cheaply.
  //
  // Every activity figure on the admin page counted TRANSACTIONS, which answers
  // a different question: it sees nobody who opened Ttip, checked their balance
  // and closed it. This is the state fetch the app makes on open, so it is the
  // honest place to stamp it — throttled to ten minutes so a session that
  // refetches doesn't write on every request, and never allowed to fail the
  // page it's attached to.
  const TEN_MINUTES = 600_000;
  if (!user.lastSeenAt || Date.now() - user.lastSeenAt.getTime() > TEN_MINUTES) {
    void prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }

  const portfolio = await buildPortfolio(user.balances, user.defaultFiat);

  // Free-swap allowance is per-day. Uses the shared helper rather than its own
  // copy of the number — this file had a second hardcoded 3, so changing the
  // allowance in swap-math left the UI still advertising free swaps.
  const freeSwaps = freeSwapsLeft(user.freeSwapDay, user.freeSwapsLeft, dayStr());

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
      freeSwapsLeft: freeSwaps,
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
    config: {
      payments: settlementStatus(),
      // Resolved here so the deposit screen quotes exactly what gets charged —
      // the per-currency overrides can't be read from a client bundle.
      depositFee: depositFeeScheduleFor(user.defaultFiat),
    },
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
