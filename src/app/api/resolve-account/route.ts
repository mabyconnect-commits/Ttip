import { z } from "zod";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized } from "@/lib/api";
import { resolveAccountName } from "@/lib/settlement";

const schema = z.object({
  bankName: z.string().min(2),
  accountNumber: z.string().min(6),
  currency: z.string().optional(),
});

/**
 * Look up a bank account holder's name so the user can confirm the recipient
 * before withdrawing. Read-only; returns { accountName: null } when it can't be
 * resolved (e.g. sandbox, or the number/bank don't match).
 */
export async function POST(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const { bankName, accountNumber, currency } = schema.parse(await req.json());
    const accountName = await resolveAccountName(bankName, accountNumber, currency ?? "NGN");
    return ok({ accountName });
  });
}
