import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized, ApiError } from "@/lib/api";
import { listTokens } from "@/lib/settlement";

export const dynamic = "force-dynamic";

// Tokens available on a given chain.
export async function GET(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const chainId = Number(new URL(req.url).searchParams.get("chainId"));
    if (!chainId) throw new ApiError("chainId is required", 400);
    return ok({ tokens: await listTokens(chainId) });
  });
}
