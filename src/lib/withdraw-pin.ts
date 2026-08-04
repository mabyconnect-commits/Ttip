import "server-only";
import { prisma } from "./db";
import { verifyPassword } from "./auth";
import { ApiError } from "./api";
import { rateLimit } from "./rate-limit";

/**
 * Require the transaction PIN before money leaves the platform.
 *
 * The PIN existed only as an app lock — anyone holding an unlocked phone, or a
 * stolen session cookie, could empty an account without ever being asked for
 * it. Anything irreversible (bank payout, crypto withdrawal) now asks.
 *
 * Sending to another Ttip user is deliberately NOT gated: it stays inside the
 * platform and can be traced and reversed by support.
 */

/** Thrown as a 428 so the client knows to send the user to set a PIN first. */
export const PIN_REQUIRED = "SET_PIN";

export async function requireWithdrawPin(userId: string, pin: string | undefined): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { pinHash: true } });

  // No PIN set: refuse rather than wave the withdrawal through. Withdrawals are
  // the one thing that can't be undone, so this is the moment to insist.
  if (!user?.pinHash) {
    throw new ApiError(
      "Set a transaction PIN before withdrawing — Account → Security takes a minute.",
      428,
    );
  }

  if (!pin) throw new ApiError("Enter your transaction PIN", 401);

  // 4 digits is 10,000 combinations. Cap guesses hard, per user.
  rateLimit(`withdraw-pin:${userId}`, { limit: 5, windowMs: 5 * 60_000 });

  if (!(await verifyPassword(pin, user.pinHash))) {
    throw new ApiError("Wrong PIN", 401);
  }
}
