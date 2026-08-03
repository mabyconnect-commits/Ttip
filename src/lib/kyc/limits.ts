import "server-only";
import { prisma } from "../db";
import { convert } from "../prices";
import { kycTierDef } from "../constants";

/**
 * Enforce the KYC tier limits on a withdrawal.
 *
 * These limits were advertised on the limits screen but never checked anywhere:
 * `kycTier` was written at verification, displayed, and otherwise unused, so a
 * Tier-1 account could withdraw any amount. This is the check that makes the
 * ladder real.
 *
 * Limits are naira-denominated, so a payout in any other currency is converted
 * to naira first and one ladder governs every currency.
 */

/** Rolling 24h window — not a calendar day, so limits can't reset at midnight. */
const WINDOW_MS = 24 * 60 * 60 * 1000;

export interface LimitCheck {
  ok: boolean;
  reason?: string;
}

export async function checkWithdrawalLimit(
  userId: string,
  tier: number,
  amountFiat: number,
  currency: string,
): Promise<LimitCheck> {
  const def = kycTierDef(tier);

  const amountNgn = currency === "NGN" ? amountFiat : await convert(amountFiat, currency, "NGN");
  if (!Number.isFinite(amountNgn) || amountNgn <= 0) {
    return { ok: false, reason: "We couldn't value that amount right now — try again in a moment." };
  }

  if (def.perTransferNgn <= 0) {
    return { ok: false, reason: "Verify your identity to withdraw." };
  }
  if (amountNgn > def.perTransferNgn) {
    return {
      ok: false,
      reason: `That's over your ₦${def.perTransferNgn.toLocaleString()} per-transfer limit on Tier ${def.tier}. Verify more under Account → Limits to raise it.`,
    };
  }

  // Everything already withdrawn in the rolling window, valued in naira.
  const since = new Date(Date.now() - WINDOW_MS);
  const recent = await prisma.transaction.findMany({
    where: {
      userId,
      type: { in: ["withdraw_bank", "withdraw_wallet"] },
      status: { in: ["completed", "pending"] },
      createdAt: { gte: since },
    },
    select: { assetOut: true, amountOut: true, assetIn: true, amountIn: true },
  });

  let usedNgn = 0;
  for (const t of recent) {
    // Bank payouts record the fiat out; crypto sends record the asset in.
    const asset = t.assetOut ?? t.assetIn;
    const amount = Number(t.amountOut ?? t.amountIn ?? 0);
    if (!asset || !(amount > 0)) continue;
    usedNgn += asset === "NGN" ? amount : await convert(amount, asset, "NGN");
  }

  if (usedNgn + amountNgn > def.dailyNgn) {
    const left = Math.max(0, def.dailyNgn - usedNgn);
    return {
      ok: false,
      reason:
        left > 0
          ? `That would pass your ₦${def.dailyNgn.toLocaleString()} daily limit on Tier ${def.tier} — you have about ₦${Math.floor(left).toLocaleString()} left today.`
          : `You've reached your ₦${def.dailyNgn.toLocaleString()} daily limit on Tier ${def.tier}. It frees up 24h after each withdrawal.`,
    };
  }

  return { ok: true };
}
