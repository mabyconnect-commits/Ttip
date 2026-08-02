import { z } from "zod";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized } from "@/lib/api";
import { validateBillCustomer } from "@/lib/settlement";

const schema = z.object({
  billerCode: z.string().min(2),
  itemCode: z.string().min(2),
  customer: z.string().min(3),
});

/**
 * Validate a bill customer (e.g. resolve the name on an electricity meter or a
 * cable smartcard) so the user can confirm before paying. Read-only; returns
 * { valid:false } when the biller can't be validated (e.g. airtime, or sandbox).
 */
export async function POST(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const { billerCode, itemCode, customer } = schema.parse(await req.json());
    const result = await validateBillCustomer(billerCode, itemCode, customer);
    return ok(result);
  });
}
