import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized } from "@/lib/api";
import { getAppState } from "@/lib/serialize";
import { CRYPTO_ASSETS } from "@/lib/constants";
import { ensureDepositAddresses } from "@/lib/settlement";
import { depositProvider } from "@/lib/settlement/config";

export const dynamic = "force-dynamic";

// List deposit addresses grouped by asset.
export async function GET() {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    // Lazily provision real Dextopus addresses when configured (no-op otherwise).
    await ensureDepositAddresses(userId).catch(() => {});
    const all = await prisma.walletAddress.findMany({ where: { userId } });

    // SAFETY: when a live provider (Dextopus) is active, only ever surface its
    // real, provider-issued addresses. Never show the deterministic demo
    // addresses in production — a user could send real crypto to a dead address.
    const live = depositProvider() !== "sandbox";
    const addresses = live ? all.filter((a) => a.provider === "dextopus") : all;

    const bySymbol: Record<string, { network: string; address: string }[]> = {};
    for (const a of addresses) {
      (bySymbol[a.symbol] ??= []).push({ network: a.network, address: a.address });
    }
    const assets = CRYPTO_ASSETS.filter((a) => bySymbol[a.symbol]).map((a) => ({
      symbol: a.symbol,
      name: a.name,
      color: a.color,
      glyph: a.glyph,
      networks: bySymbol[a.symbol],
    }));
    return ok({ assets, live });
  });
}

/*
 * The deposit SIMULATOR has been removed.
 *
 * It credited a real, withdrawable balance with no money behind it — the single
 * biggest hole in the ledger, and the source of the unfunded balances the
 * funding audit found. There is no safe way to keep it: any endpoint that can
 * mint balance is one bad env var away from doing it in production.
 *
 * Deposits now only ever arrive through the provider webhook
 * (/api/webhooks/deposit), which requires a signed payload, or a real fiat
 * collection. To test the credit path, drive that webhook with a valid
 * signature — it is the same code path production uses.
 *
 * Reversing balances the simulator already created: `npm run audit:funding`
 * then `npm run clawback -- --apply`.
 */
