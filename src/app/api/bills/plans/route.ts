import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized, ApiError } from "@/lib/api";
import { getCategoryCatalog } from "@/lib/settlement";

export const dynamic = "force-dynamic";

/**
 * Return the providers + plans for a bill category (airtime, data, tv,
 * electricity, internet). Live mode serves Flutterwave's real biller items;
 * demo mode serves the curated static catalog. Read-only.
 *
 *   /api/bills/plans?category=data
 */
export async function GET(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const category = new URL(req.url).searchParams.get("category");
    if (!category) throw new ApiError("Missing category", 400);
    const catalog = await getCategoryCatalog(category);
    if (!catalog) throw new ApiError("Unknown bill category", 404);
    return ok({ category: catalog.category, providers: catalog.providers });
  });
}
