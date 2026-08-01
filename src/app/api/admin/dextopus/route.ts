import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { dextopusConfig } from "@/lib/settlement/config";

export const dynamic = "force-dynamic";

/**
 * TEMPORARY diagnostic: shows what Dextopus supports (chains, tokens) and the
 * raw result of a static-address generate attempt, so we can wire every
 * asset/chain correctly. Login-gated; returns no secrets (the settlement address
 * is truncated). Remove once deposit provisioning is verified.
 *
 * Hit while signed in:
 *   /api/admin/dextopus                      → chains + settlement-chain tokens + a generate attempt
 *   /api/admin/dextopus?originChainId=1&originAsset=USDT
 */
export async function GET(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "sign in first" }, { status: 401 });

  const cfg = dextopusConfig();
  if (!cfg) return NextResponse.json({ error: "Dextopus not configured (DEXTOPUS_API_KEY missing)" }, { status: 400 });

  const url = new URL(req.url);
  const originChainId = Number(url.searchParams.get("originChainId") ?? 728126428); // default Tron
  const originAsset = url.searchParams.get("originAsset") ?? "USDT";

  const headers = { "x-api-key": cfg.apiKey };
  async function call(path: string, init?: RequestInit) {
    try {
      const r = await fetch(`${cfg!.baseUrl}${path}`, init);
      const body = await r.json().catch(() => null);
      return { status: r.status, body };
    } catch (e) {
      return { error: String((e as Error)?.message ?? e) };
    }
  }

  const out: Record<string, unknown> = {
    settlementTarget: {
      chainId: cfg.settlementChainId,
      asset: cfg.settlementAsset,
      address: cfg.settlementAddress ? cfg.settlementAddress.slice(0, 6) + "…" + cfg.settlementAddress.slice(-4) : null,
      refundToSet: !!cfg.refundTo,
    },
    chains: await call("/deposit/chains", { headers }),
    tokensOnSettlementChain: await call(`/deposit/tokens?chainId=${cfg.settlementChainId}`, { headers }),
    tokensOnOriginChain: await call(`/deposit/tokens?chainId=${originChainId}`, { headers }),
    generateAttempt: await call("/deposit/static/generate", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        originChainId,
        originAsset,
        settlementChainId: cfg.settlementChainId,
        settlementAsset: cfg.settlementAsset,
        settlementAddress: cfg.settlementAddress,
        ...(cfg.refundTo ? { refundTo: cfg.refundTo } : {}),
        metadata: { source: "ttip-debug" },
      }),
    }),
  };

  return NextResponse.json(out, { status: 200 });
}
