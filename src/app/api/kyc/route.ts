import { z } from "zod";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized } from "@/lib/api";
import { getAppState } from "@/lib/serialize";

const schema = z.object({
  fullName: z.string().min(2, "Enter your full legal name"),
  idType: z.enum(["bvn", "nin", "passport", "drivers_license"]),
  idNumber: z.string().min(6, "Enter a valid ID number"),
});

// Submit KYC. In this build verification is simulated (instant approval).
// A production build routes this to an identity provider (e.g. Smile ID, Dojah).
export async function POST(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    schema.parse(await req.json());
    await prisma.user.update({
      where: { id: userId },
      data: { kycStatus: "verified", kycTier: 2, verified: true },
    });
    const state = await getAppState(userId);
    return ok(state);
  });
}
