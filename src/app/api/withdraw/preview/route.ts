import { z } from "zod";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized } from "@/lib/api";
import { dextopusWithdrawPreview } from "@/lib/settlement";

const schema = z.object({
  symbol: z.string(),
  chainId: z.number().optional(),
  network: z.string().optional(),
  address: z.string().min(4),
  amount: z.number().positive(),
});

/**
 * Preview a crypto withdrawal (dry quote, no money moves): returns the real
 * amount the recipient will receive after cross-chain + network fees, or a
 * clear reason it can't go through. Lets the user see what actually arrives
 * before confirming.
 */
export async function POST(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const input = schema.parse(await req.json());
    const preview = await dextopusWithdrawPreview({
      asset: input.symbol,
      network: input.network,
      chainId: input.chainId,
      address: input.address,
      amount: input.amount,
      reference: "",
    });
    return ok(preview);
  });
}
