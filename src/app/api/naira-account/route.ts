import { z } from "zod";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized, ApiError } from "@/lib/api";
import { getAppState } from "@/lib/serialize";
import { ensureNairaAccount } from "@/lib/settlement";

const schema = z.object({
  bvn: z.string().regex(/^\d{11}$/, "Enter your 11-digit BVN"),
});

/**
 * Activate (or retry) a user's dedicated naira account. The DVA is normally
 * provisioned at KYC time, but if that call failed — or the user verified before
 * the feature existed — this lets them finish setup from the deposit screen. It
 * surfaces the provider's real error instead of silently spinning forever.
 *
 * Gated on a verified account; the BVN is used only to open the account and is
 * not stored.
 */
export async function POST(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return unauthorized();

    if (user.nairaAccount) {
      // Already provisioned — just return current state.
      return ok(await getAppState(userId));
    }
    if (user.kycStatus !== "verified") {
      throw new ApiError("Verify your identity first to get a naira account.", 403);
    }

    const { bvn } = schema.parse(await req.json());

    const result = await ensureNairaAccount(userId, { bvn, name: user.name, email: user.email });
    if (!result.ok) {
      // Bubble the provider's exact reason so the user (and we) can act on it.
      throw new ApiError(result.error, 502);
    }

    return ok(await getAppState(userId));
  });
}
