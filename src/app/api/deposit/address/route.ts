import { z } from "zod";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized, ApiError } from "@/lib/api";
import { getOrCreateDepositAddress } from "@/lib/settlement";

export const dynamic = "force-dynamic";

const schema = z.object({
  chainId: z.number(),
  symbol: z.string().min(1),
  network: z.string().min(1), // human chain name, used for display + storage key
});

// Generate (or return) the user's static deposit address for one chain + token.
export async function POST(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const { chainId, symbol, network } = schema.parse(await req.json());
    const res = await getOrCreateDepositAddress(userId, chainId, symbol.toUpperCase(), network);
    if (!res) {
      throw new ApiError(`${symbol} on ${network} isn't available for deposit right now. Try another asset or chain.`, 422);
    }
    return ok(res);
  });
}
