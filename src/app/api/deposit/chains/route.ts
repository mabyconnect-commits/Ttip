import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized } from "@/lib/api";
import { listChains } from "@/lib/settlement";

export const dynamic = "force-dynamic";

// Every chain Dextopus supports, for the on-demand deposit picker.
export async function GET() {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    return ok({ chains: await listChains() });
  });
}
