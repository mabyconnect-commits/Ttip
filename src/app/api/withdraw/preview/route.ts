import { z } from "zod";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized } from "@/lib/api";
import {
  dextopusWithdrawPreview,
  solanaWithdrawSupported,
  isValidSolanaAddress,
  solFeeReserve,
} from "@/lib/settlement";
import { cryptoWithdrawFeeUsd } from "@/lib/fees";
import { convert, toUsd } from "@/lib/prices";

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

    // Anything the treasury sends itself on Solana is quoted here, not by the
    // bridge. Asking Dextopus about SOL returned "SOL can't be withdrawn on
    // this network" — true of their route, and untrue of ours: the treasury
    // signs on Solana, so a native send never touches them.
    const solana = /sol/i.test(input.network ?? "") || input.chainId === 792703809;
    if (solana && solanaWithdrawSupported(input.symbol)) {
      if (!isValidSolanaAddress(input.address)) {
        return ok({ ok: false, message: "That isn't a valid Solana address." });
      }
      // Our fee — 0.8% with a $0.50 floor — charged in the asset being sent.
      // Priced the same way the send path prices it, so the quote and the
      // charge agree; two answers to "what does this cost" is worse than one
      // that's slightly off.
      const amountUsd = await toUsd(input.amount, input.symbol).catch(() => 0);
      const fee = await convert(cryptoWithdrawFeeUsd(amountUsd), "USDT", input.symbol);
      const out = input.amount - fee;
      if (!(out > 0)) {
        return ok({ ok: false, message: `That's below the ${input.symbol} withdrawal fee.` });
      }
      return ok({ ok: true, amountOut: out });
    }

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
