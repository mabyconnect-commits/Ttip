import { z } from "zod";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized, ApiError } from "@/lib/api";
import { getAppState } from "@/lib/serialize";
import { isCrypto } from "@/lib/prices";
import { createBuyOrder, settlementEnabled } from "@/lib/settlement";

const schema = z.object({
  symbol: z.string(),
  fiat: z.string().optional(),
  fiatAmount: z.number().positive("Enter an amount"),
});

/**
 * Buy crypto with fiat (card/bank). Sandbox credits instantly; live returns a
 * hosted checkout URL and credits the crypto when the collection webhook
 * confirms payment. Requires a verified identity, like every money movement.
 */
export async function POST(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return unauthorized();

    // Fail closed: no simulated crypto credit unless live or explicitly in demo.
    if (!settlementEnabled()) {
      throw new ApiError("Buying crypto isn't available yet. Please check back soon.", 503);
    }

    const input = schema.parse(await req.json());
    if (!isCrypto(input.symbol)) throw new ApiError("Pick a crypto asset to buy", 400);
    if (user.kycStatus !== "verified") {
      throw new ApiError("Verify your identity (BVN) to buy crypto. It takes about a minute under Account → Verify.", 403);
    }

    const fiat = input.fiat ?? user.defaultFiat;
    const origin = new URL(req.url).origin;

    let result;
    try {
      result = await createBuyOrder({
        userId,
        email: user.email,
        symbol: input.symbol,
        fiat,
        fiatAmount: input.fiatAmount,
        callbackUrl: `${origin}/home`,
      });
    } catch (e: any) {
      throw new ApiError(e.message ?? "Could not start your purchase", 400);
    }

    if (result.status === "failed") {
      throw new ApiError(result.message ?? "Payment could not be started", 502);
    }

    const state = await getAppState(userId);
    return ok({
      ...state,
      buy: {
        status: result.status, // "completed" (sandbox) or "pending" (live → checkout)
        symbol: input.symbol,
        fiat,
        fiatAmount: input.fiatAmount,
        amountAsset: result.amountAsset,
        rate: result.rate,
        checkoutUrl: result.checkoutUrl,
        reference: result.reference,
      },
    });
  });
}
