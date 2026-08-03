import "server-only";
import { prisma } from "../db";
import { ensureNairaAccount } from "../settlement";
import type { KycRequest, KycResult } from "./types";

/**
 * Identity verification via Flutterwave.
 *
 * Opening a permanent, BVN-linked dedicated account makes Flutterwave validate
 * the BVN against NIBSS — so a *successful* account creation is proof the BVN is
 * real and bank-verified. We treat that as Tier-1 verification, and the user
 * gets their naira account in the very same step (no separate KYC vendor, no
 * second BVN entry).
 *
 * Only BVN is supported here (that's what Flutterwave checks). For stricter
 * name-matching on higher tiers, route those through Dojah via KYC_PROVIDER.
 */
export async function flutterwaveVerify(req: KycRequest): Promise<KycResult> {
  if (req.idType !== "bvn") {
    return { status: "failed", tier: 1, provider: "flutterwave", reason: "Please verify with your BVN." };
  }
  const bvn = req.idNumber.replace(/\D/g, "");
  if (!/^\d{11}$/.test(bvn)) {
    return { status: "failed", tier: 1, provider: "flutterwave", reason: "Enter a valid 11-digit BVN." };
  }

  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { email: true, name: true } });
  if (!user) return { status: "failed", tier: 1, provider: "flutterwave", reason: "Account not found." };

  const result = await ensureNairaAccount(req.userId, { bvn, name: req.fullName || user.name, email: user.email });
  if (!result.ok) {
    return { status: "failed", tier: 1, provider: "flutterwave", reason: result.error };
  }

  // Only a freshly OPENED account proves anything: that is the call where
  // Flutterwave checked the BVN against NIBSS. If the user already had an
  // account, ensureNairaAccount returned early and never looked at the number
  // just submitted — treating that as "verified" let any 11 digits through,
  // including a NIN typed into the BVN field. Send it to manual review instead.
  if (!result.created) {
    return {
      status: "pending",
      tier: 1,
      provider: "flutterwave",
      reason: "We couldn't automatically confirm that ID. Our team will review it shortly.",
      matched: false,
    };
  }

  // BVN confirmed real + account provisioned → Tier 1.
  return { status: "verified", tier: 1, provider: "flutterwave", ref: result.accountNumber, matched: true };
}
