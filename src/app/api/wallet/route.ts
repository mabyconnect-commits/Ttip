import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized } from "@/lib/api";
import { getAppState } from "@/lib/serialize";

export const dynamic = "force-dynamic";

export async function GET() {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const state = await getAppState(userId);
    if (!state) return unauthorized();
    return ok(state);
  });
}
