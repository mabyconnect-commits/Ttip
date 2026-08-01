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

  const chains = await call("/deposit/chains", { headers });

  // Build a compact, readable summary: chainId + name + static-address support.
  let chainSummary: unknown = "unreadable";
  try {
    const body = (chains as { body?: unknown }).body as Record<string, unknown> | unknown[] | undefined;
    const list = (Array.isArray(body) ? body : ((body as Record<string, unknown>)?.chains ?? (body as Record<string, unknown>)?.data)) as
      | Record<string, unknown>[]
      | undefined;
    if (Array.isArray(list)) {
      chainSummary = list.map((c) => ({
        chainId: c.chainId ?? c.id,
        name: c.name,
        static: c.supportsStaticAddress ?? c.supportsStaticAddresses ?? undefined,
      }));
    }
  } catch {
    /* leave as unreadable */
  }

  // Fetch a chain's tokens and normalize to [{symbol, address, decimals}].
  async function tokens(chainId: number) {
    const r = await call(`/deposit/tokens?chainId=${chainId}`);
    const body = (r as { body?: unknown }).body as Record<string, unknown> | unknown[] | undefined;
    const list = (Array.isArray(body) ? body : ((body as Record<string, unknown>)?.tokens ?? (body as Record<string, unknown>)?.data)) as
      | Record<string, unknown>[]
      | undefined;
    if (!Array.isArray(list)) return { raw: r };
    return list.map((t) => ({ symbol: t.symbol, address: t.address ?? t.contractAddress ?? t.mint, decimals: t.decimals }));
  }

  function findAddr(list: unknown, symbol: string): string | undefined {
    if (!Array.isArray(list)) return undefined;
    const hit = list.find((t) => String((t as { symbol?: string }).symbol ?? "").toUpperCase() === symbol.toUpperCase());
    return hit ? String((hit as { address?: string }).address ?? "") : undefined;
  }

  const settlementTokens = await tokens(cfg.settlementChainId!);
  const originTokens = await tokens(originChainId);
  const resolvedSettlementAsset = findAddr(settlementTokens, cfg.settlementAsset ?? "USDC");
  const resolvedOriginAsset = findAddr(originTokens, originAsset);

  async function tryGenerate(oAsset: string, sAsset: string) {
    return call("/deposit/static/generate", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        originChainId,
        originAsset: oAsset,
        settlementChainId: cfg!.settlementChainId,
        settlementAsset: sAsset,
        settlementAddress: cfg!.settlementAddress,
        ...(cfg!.refundTo ? { refundTo: cfg!.refundTo } : {}),
        metadata: { source: "ttip-debug" },
      }),
    });
  }

  const out = {
    settlementTarget: {
      chainId: cfg.settlementChainId,
      asset: cfg.settlementAsset,
      address: cfg.settlementAddress ? cfg.settlementAddress.slice(0, 6) + "…" + cfg.settlementAddress.slice(-4) : null,
      refundToSet: !!cfg.refundTo,
    },
    resolvedOriginAsset,
    resolvedSettlementAsset,
    settlementTokensSample: Array.isArray(settlementTokens) ? settlementTokens.slice(0, 8) : settlementTokens,
    originTokensSample: Array.isArray(originTokens) ? originTokens.slice(0, 8) : originTokens,
    generateWithSymbols: await tryGenerate(originAsset, cfg.settlementAsset ?? "USDC"),
    generateWithAddresses: resolvedOriginAsset && resolvedSettlementAsset ? await tryGenerate(resolvedOriginAsset, resolvedSettlementAsset) : "could not resolve token addresses",
    chainSummaryCount: Array.isArray(chainSummary) ? chainSummary.length : chainSummary,
  };

  return NextResponse.json(out, { status: 200 });
}
