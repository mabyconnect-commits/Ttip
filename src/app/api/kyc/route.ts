import { z } from "zod";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized, ApiError } from "@/lib/api";
import { getAppState } from "@/lib/serialize";
import { verifyIdentity, kycEnabled } from "@/lib/kyc";

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

    // Verified.
    await prisma.user.update({
      where: { id: userId },
      data: {
        kycStatus: "verified",
        kycTier: Math.max(2, result.tier),
        verified: true,
        kycProvider: result.provider,
        kycRef: result.ref ?? null,
        kycVerifiedAt: new Date(),
      },
    });
    const state = await getAppState(userId);
    return ok({ ...state, kyc: { status: "verified" } });
  });
}
