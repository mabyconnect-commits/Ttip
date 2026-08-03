import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized, ApiError } from "@/lib/api";
import { getAppState } from "@/lib/serialize";
import { verifyIdentity, kycEnabled } from "@/lib/kyc";
import { hashBvn, maskBvn } from "@/lib/kyc/bvn";
import { tierFor, withIdType } from "@/lib/kyc/tier";
import { ensureNairaAccount } from "@/lib/settlement";

const schema = z.object({
  fullName: z.string().min(2, "Enter your full legal name"),
  idType: z.enum(["bvn", "nin", "passport", "drivers_license"]),
  idNumber: z.string().min(6, "Enter a valid ID number"),
});

/**
 * Submit KYC. In sandbox mode a well-formed ID verifies instantly; in live mode
 * the BVN/NIN is checked against the government record via Dojah and the name
 * must match. Only a genuine "verified" result activates the account — bank and
 * crypto withdrawals are gated on kycStatus === "verified".
 */
export async function POST(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();

    // Fail closed: if identity verification isn't wired (not live, not demo),
    // refuse rather than instantly approving — a fake ID must never verify a
    // real account in production.
    if (!kycEnabled()) {
      throw new ApiError("Identity verification isn't available yet. Please check back soon.", 503);
    }

    const input = schema.parse(await req.json());

    // Bind the BVN to this account: a BVN can verify exactly ONE Ttip account.
    // We store a keyed hash (never the raw number) so it's unique + traceable.
    const bvnHash = input.idType === "bvn" ? hashBvn(input.idNumber) : null;
    const bvnLast4 = input.idType === "bvn" ? maskBvn(input.idNumber) : null;
    if (bvnHash) {
      const taken = await prisma.user.findFirst({ where: { bvnHash, id: { not: userId } }, select: { id: true } });
      if (taken) throw new ApiError("This BVN is already linked to another Ttip account. Each BVN can verify only one account.", 409);
    }

    // Already verified? Don't re-charge the identity provider — just make sure the
    // dedicated naira account exists (activates it for users who verified before
    // this feature), using the BVN they re-entered.
    const existing = await prisma.user.findUnique({ where: { id: userId } });
    // Short-circuit only when this exact document is already on file. Submitting
    // a NEW document (a Tier-1 user adding a government ID) must run the real
    // check so the tier can go up — otherwise "already verified" would cap
    // everyone at whatever they first proved.
    const alreadyOnFile = (existing?.kycIdTypes ?? []).includes(input.idType);
    if (existing?.kycStatus === "verified" && alreadyOnFile) {
      // Backfill the BVN binding for accounts verified before this existed.
      if (bvnHash && !existing.bvnHash) {
        await prisma.user.update({ where: { id: userId }, data: { bvnHash, bvnLast4 } }).catch(() => {});
      }
      // BVN only — a dedicated account is opened against NIBSS with a BVN, so
      // passing a NIN here would send the wrong number to the provider.
      if (!existing.nairaAccount && input.idType === "bvn") {
        try {
          await ensureNairaAccount(userId, { bvn: input.idNumber.replace(/\D/g, ""), name: existing.name, email: existing.email });
        } catch {
          /* best-effort */
        }
      }
      const state = await getAppState(userId);
      return ok({ ...state, kyc: { status: "verified" } });
    }

    const result = await verifyIdentity({
      userId,
      fullName: input.fullName,
      idType: input.idType,
      idNumber: input.idNumber,
    });

    if (result.status === "failed") {
      // Record the failed attempt but don't verify the account.
      await prisma.user.update({
        where: { id: userId },
        data: { kycStatus: "unverified", kycProvider: result.provider, kycRef: result.ref ?? null },
      });
      throw new ApiError(result.reason ?? "We couldn't verify that ID.", 422);
    }

    if (result.status === "pending") {
      await prisma.user.update({
        where: { id: userId },
        data: { kycStatus: "pending", kycProvider: result.provider, kycRef: result.ref ?? null },
      });
      const state = await getAppState(userId);
      return ok({ ...state, kyc: { status: "pending", message: result.reason } });
    }

    // Verified. Persist the BVN binding too (unique — a concurrent duplicate is
    // caught by the constraint and rejected).
    let verifiedUser;
    try {
      // The tier is derived from the documents actually verified — a BVN alone
      // is Tier 1, not Tier 2. `Math.max(2, ...)` used to hand every verified
      // user Tier 2 limits on the strength of a single BVN.
      const idTypes = withIdType(existing?.kycIdTypes ?? [], input.idType);
      verifiedUser = await prisma.user.update({
        where: { id: userId },
        data: {
          kycStatus: "verified",
          kycIdTypes: idTypes,
          kycTier: tierFor(idTypes),
          verified: true,
          kycProvider: result.provider,
          kycRef: result.ref ?? null,
          kycVerifiedAt: new Date(),
          ...(bvnHash ? { bvnHash, bvnLast4 } : {}),
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ApiError("This BVN is already linked to another Ttip account. Each BVN can verify only one account.", 409);
      }
      throw e;
    }

    // Provision a dedicated naira account now that we have a verified BVN.
    // Best-effort — never let account creation fail the verification.
    if (input.idType === "bvn") {
      try {
        await ensureNairaAccount(userId, {
          bvn: input.idNumber.replace(/\D/g, ""),
          name: verifiedUser.name,
          email: verifiedUser.email,
        });
      } catch {
        /* ignore — user can retry from the deposit screen */
      }
    }

    const state = await getAppState(userId);
    return ok({ ...state, kyc: { status: "verified" } });
  });
}
