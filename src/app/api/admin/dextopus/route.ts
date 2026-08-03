import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { dextopusConfig } from "@/lib/settlement/config";
import { resolveTokenAddress } from "@/lib/settlement/dextopus";
import { treasurySolanaBalances } from "@/lib/settlement/solana";
import { chainIdForNetwork, explorerTxUrl } from "@/lib/chains";
import { toUsd } from "@/lib/prices";

export const dynamic = "force-dynamic";

/**
 * Only an operator may reach the diagnostic. Set ADMIN_EMAILS (comma-separated)
 * to your own account email(s) in production; otherwise it's available only on a
 * demo deployment. Anyone else gets a 404 (route existence is not revealed).
 */
async function isAdmin(userId: string): Promise<boolean> {
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!admins.length) return process.env.DEMO_MODE === "true";
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return !!user && admins.includes(user.email.toLowerCase());
}

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
  if (!(await isAdmin(userId))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const cfg = dextopusConfig();
  if (!cfg) return NextResponse.json({ error: "Dextopus not configured (DEXTOPUS_API_KEY missing)" }, { status: 400 });

  const url = new URL(req.url);
  const originChainId = Number(url.searchParams.get("originChainId") ?? 728126428); // default Tron
  const originAsset = url.searchParams.get("originAsset") ?? "USDT";
  const depositsFor = url.searchParams.get("deposits"); // a deposit address to inspect

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

  // ── Withdrawal diagnostics ────────────────────────────────────────────────
  // ?withdrawals=1[&minutes=10][&reference=…] → why a withdrawal is stuck.
  if (url.searchParams.get("withdrawals") === "1") {
    const minutes = Number(url.searchParams.get("minutes") ?? 10);
    const ref = url.searchParams.get("reference");
    const pending = await prisma.settlement.findMany({
      where: { kind: "withdrawal", provider: "dextopus", status: "pending", ...(ref ? { reference: ref } : {}) },
      orderBy: { createdAt: "asc" },
      take: 25,
    });
    const withdrawals = [];
    for (const s of pending) {
      const raw = (s.raw ?? {}) as { dextopusRequestId?: string; fundingTx?: string; fundingError?: string };
      const requestId = raw.dextopusRequestId;
      const ageMinutes = Math.round((Date.now() - s.createdAt.getTime()) / 60000);
      const status = requestId ? await call(`/deposit/status?depositRequestId=${encodeURIComponent(requestId)}`, { headers }) : null;
      withdrawals.push({
        reference: s.reference,
        requestId: requestId ?? null,
        asset: s.asset,
        amount: Number(s.amount),
        destination: s.address,
        fundingTx: raw.fundingTx ?? null,
        fundingTxUrl: raw.fundingTx ? explorerTxUrl(792703809, raw.fundingTx) : null,
        fundingError: raw.fundingError ?? null, // why the treasury send failed, if it did
        ageMinutes,
        stuck: ageMinutes >= minutes,
        status,
        diagnosis: interpretWithdrawal(requestId, status, ageMinutes, minutes, raw.fundingError),
      });
    }
    return NextResponse.json({ pendingCount: pending.length, stuckThresholdMinutes: minutes, treasury: await treasurySolanaBalances(), withdrawals });
  }

  // ?dryRun=1&asset=USDT&network=tron&address=…&amount=2 → preview a withdrawal
  // (fees + output) WITHOUT moving money, to verify config end-to-end.
  if (url.searchParams.get("dryRun") === "1") {
    const asset = url.searchParams.get("asset") ?? "USDT";
    const network = url.searchParams.get("network") ?? "tron";
    const address = url.searchParams.get("address") ?? "";
    const amount = Number(url.searchParams.get("amount") ?? 2);
    const destinationChainId = chainIdForNetwork(network);
    const [oAsset, dAsset] = await Promise.all([
      resolveTokenAddress(cfg, cfg.settlementChainId!, cfg.settlementAsset ?? "USDC"),
      destinationChainId ? resolveTokenAddress(cfg, destinationChainId, asset) : Promise.resolve(undefined),
    ]);
    const usdc = await toUsd(amount, asset);
    const quote = await call("/deposit/quote", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        originChainId: cfg.settlementChainId,
        originAsset: oAsset,
        destinationChainId,
        destinationAsset: dAsset,
        amount: Math.round(usdc * 1e6).toString(),
        recipient: address,
        refundTo: cfg.settlementAddress,
        dry: true,
        metadata: { source: "ttip-debug" },
      }),
    });
    return NextResponse.json({
      input: { asset, network, amount, address: address ? address.slice(0, 6) + "…" + address.slice(-4) : "(none — pass &address=)" },
      resolved: { originChainId: cfg.settlementChainId, destinationChainId, originAsset: oAsset ?? "UNRESOLVED", destinationAsset: dAsset ?? "UNRESOLVED", sendUsdc: usdc },
      dryRunQuote: quote,
      diagnosis: interpretDryRun(destinationChainId, oAsset, dAsset, quote),
    });
  }

  // ?deposits=<address> → what Dextopus recorded for that address (incl. failed/
  // refunded), to trace a wrong-asset deposit.
  if (depositsFor) {
    return NextResponse.json({
      depositAddress: depositsFor,
      deposits: await call(`/deposit/static/deposits?depositAddress=${encodeURIComponent(depositsFor)}`, { headers }),
    });
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

/** Plain-English read of why a pending withdrawal is where it is. */
function interpretWithdrawal(requestId: string | undefined, statusResp: unknown, ageMinutes: number, minutes: number, fundingError?: string): string {
  if (fundingError) {
    return `The treasury Solana send FAILED — Dextopus was never funded, so this can't deliver. Error: "${fundingError}". It will auto-refund the user on reconcile. Fix the underlying send (see error) before retrying.`;
  }
  if (!requestId) {
    return "No Dextopus request id was recorded — the quote or the treasury funding never completed, so nothing was handed to Dextopus. Check the funding tx and the /api/send logs; this one won't auto-reconcile.";
  }
  const r = statusResp as { status?: number; body?: any; error?: string } | null;
  if (!r || r.error) return `Couldn't read Dextopus status (${r?.error ?? "no response"}). Retry.`;
  const body = r.body?.data ?? r.body ?? {};
  const s = String(body.status ?? "").toLowerCase();
  const e = String(body.executionStatus ?? "").toLowerCase();
  const both = `${s} ${e}`;
  if (/complete|settled|delivered|success/.test(both)) {
    return "Delivered on Dextopus ✅ — it just hasn't been finalized in Ttip yet. Hit /api/cron/withdrawals (or wait for the cron) to mark it completed.";
  }
  if (/fail|expired|refund|error/.test(both)) {
    return `Dextopus reports "${s || e}" — this withdrawal will be refunded to the user on the next reconcile pass.`;
  }
  if (ageMinutes >= minutes) {
    return `Still processing after ${ageMinutes} min (status="${s || "?"}", execution="${e || "?"}"). Confirm the funding tx actually landed on Solana (fundingTxUrl); if it did, Dextopus is still awaiting confirmations or routing to the destination chain. If the funding tx is missing/failed, the treasury may be short on USDC or SOL for fees.`;
  }
  return `Processing normally (${ageMinutes} min): status="${s || "?"}", execution="${e || "?"}".`;
}

/** Read of a dry-run quote — confirms the withdrawal path resolves before going live. */
function interpretDryRun(destChainId: number | null, oAsset: string | undefined, dAsset: string | undefined, quote: unknown): string {
  if (!destChainId) return "Unknown network — no Dextopus chain id maps to it. Use a supported network.";
  if (!oAsset) return "Treasury (origin) asset didn't resolve on Dextopus — check DEXTOPUS_SETTLEMENT_ASSET/CHAIN_ID.";
  if (!dAsset) return "Destination asset isn't listed on that chain in Dextopus — the user can't receive it there.";
  const q = quote as { status?: number; body?: any; error?: string } | null;
  if (!q || q.error) return `Couldn't reach the quote endpoint (${q?.error ?? "no response"}).`;
  if (q.status && q.status >= 400) return `Dextopus rejected the quote (${q.status}): "${q.body?.message ?? "see body"}". Fix the request before going live.`;
  return "Quote OK ✅ — origin/destination resolve and Dextopus returns a preview. Withdrawals should work; check dryRunQuote.body for the expected amountOut and fees.";
}
