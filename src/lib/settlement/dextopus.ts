import "server-only";
import { dextopusConfig, type DextopusConfig } from "./config";

/**
 * Dextopus crypto-deposit provider — cross-chain settlement across 70+ networks,
 * non-custodial, ~0.25%/tx. A static per-user address is generated per origin
 * chain/asset; whatever the user sends is cross-chain-settled to your treasury
 * asset/address, and a signed webhook hits /api/webhooks/deposit.
 *
 * Dextopus identifies assets by their on-chain **token address** (native assets
 * use the 0xEeee… sentinel), so we resolve symbols → addresses via
 * /deposit/tokens before generating.
 *
 * API: https://swap-api.dextopus.com/api  (auth: `x-api-key`)
 */

export interface DextopusAddress {
  id: string;
  address: string;
  originChainId: number;
  originAsset: string;
}

// Per-chain token list cache: symbol(upper) → token address.
const tokenCache = new Map<number, { at: number; bySymbol: Record<string, string> }>();

async function tokensForChain(cfg: DextopusConfig, chainId: number): Promise<Record<string, string>> {
  const cached = tokenCache.get(chainId);
  if (cached && Date.now() - cached.at < 6 * 60 * 60 * 1000) return cached.bySymbol;
  const res = await fetch(`${cfg.baseUrl}/deposit/tokens?chainId=${chainId}`, { headers: { "x-api-key": cfg.apiKey } });
  const bySymbol: Record<string, string> = {};
  if (res.ok) {
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | unknown[] | null;
    const list = (Array.isArray(body) ? body : ((body as Record<string, unknown>)?.tokens ?? (body as Record<string, unknown>)?.data)) as
      | Record<string, unknown>[]
      | undefined;
    for (const t of list ?? []) {
      const symbol = String(t.symbol ?? "").toUpperCase();
      const address = String(t.address ?? t.contractAddress ?? t.mint ?? "");
      if (symbol && address && !(symbol in bySymbol)) bySymbol[symbol] = address;
    }
  }
  tokenCache.set(chainId, { at: Date.now(), bySymbol });
  return bySymbol;
}

/** Resolve an asset symbol to its Dextopus token address on a given chain. */
export async function resolveTokenAddress(cfg: DextopusConfig, chainId: number, symbol: string): Promise<string | undefined> {
  const bySymbol = await tokensForChain(cfg, chainId);
  return bySymbol[symbol.toUpperCase()];
}

// ---- Discovery: every supported chain + token (for the on-demand deposit UI) ----

export interface DxChain {
  chainId: number;
  name: string;
}
export interface DxToken {
  symbol: string;
  name: string;
}

let chainsCache: { at: number; chains: DxChain[] } | null = null;

/** All chains Dextopus supports (cached 6h). */
export async function listChains(): Promise<DxChain[]> {
  const cfg = dextopusConfig();
  if (!cfg) return [];
  if (chainsCache && Date.now() - chainsCache.at < 6 * 60 * 60 * 1000) return chainsCache.chains;
  const res = await fetch(`${cfg.baseUrl}/deposit/chains`, { headers: { "x-api-key": cfg.apiKey } });
  if (!res.ok) return chainsCache?.chains ?? [];
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | unknown[] | null;
  const list = (Array.isArray(body) ? body : ((body as Record<string, unknown>)?.chains ?? (body as Record<string, unknown>)?.data)) as
    | Record<string, unknown>[]
    | undefined;
  const chains = (list ?? [])
    .map((c) => ({ chainId: Number(c.chainId ?? c.id), name: String(c.name ?? "") }))
    .filter((c) => c.chainId && c.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  chainsCache = { at: Date.now(), chains };
  return chains;
}

// Cache the full token objects per chain (for names + symbols).
const tokenListCache = new Map<number, { at: number; tokens: DxToken[] }>();

/** Tokens on a chain that actually support static deposit addresses (cached 6h). */
export async function listTokens(chainId: number): Promise<DxToken[]> {
  const cfg = dextopusConfig();
  if (!cfg) return [];
  const cached = tokenListCache.get(chainId);
  if (cached && Date.now() - cached.at < 6 * 60 * 60 * 1000) return cached.tokens;
  // Ask Dextopus for only the tokens that support static addresses, so users
  // never see a token that would fail with "not available".
  const res = await fetch(`${cfg.baseUrl}/deposit/tokens?chainId=${chainId}&supportsStaticAddress=true`, { headers: { "x-api-key": cfg.apiKey } });
  const tokens: DxToken[] = [];
  if (res.ok) {
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | unknown[] | null;
    const list = (Array.isArray(body) ? body : ((body as Record<string, unknown>)?.tokens ?? (body as Record<string, unknown>)?.data)) as
      | Record<string, unknown>[]
      | undefined;
    // Belt-and-braces: if the payload still carries the flag, honour it.
    const flagged = (list ?? []).some((t) => "supportsStaticAddress" in t);
    const seen = new Set<string>();
    for (const t of list ?? []) {
      if (flagged && t.supportsStaticAddress === false) continue;
      const symbol = String(t.symbol ?? "").toUpperCase();
      if (!symbol || seen.has(symbol)) continue;
      seen.add(symbol);
      tokens.push({ symbol, name: String(t.name ?? symbol) });
    }
  }
  tokenListCache.set(chainId, { at: Date.now(), tokens });
  return tokens;
}

/**
 * Generate a reusable (static) deposit address for a user, for `originSymbol` on
 * `originChainId`, settling to the configured treasury asset/address. Returns
 * null when Dextopus isn't configured or the asset isn't supported on that chain.
 */
export async function createDepositAddress(
  userId: string,
  originChainId: number,
  originSymbol: string,
): Promise<DextopusAddress | null> {
  const cfg = dextopusConfig();
  if (!cfg || cfg.settlementChainId == null || !cfg.settlementAsset || !cfg.settlementAddress) return null;

  const [originAsset, settlementAsset] = await Promise.all([
    resolveTokenAddress(cfg, originChainId, originSymbol),
    resolveTokenAddress(cfg, cfg.settlementChainId, cfg.settlementAsset),
  ]);
  if (!originAsset || !settlementAsset) return null; // asset not listed on that chain

  const res = await fetch(`${cfg.baseUrl}/deposit/static/generate`, {
    method: "POST",
    headers: { "x-api-key": cfg.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      originChainId,
      originAsset,
      settlementChainId: cfg.settlementChainId,
      settlementAsset,
      settlementAddress: cfg.settlementAddress,
      ...(cfg.refundTo ? { refundTo: cfg.refundTo } : {}),
      metadata: { source: "ttip" },
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => ({}))) as { data?: { id?: string; depositAddress?: string }; depositAddress?: string };
  const address = json.data?.depositAddress ?? json.depositAddress;
  return address ? { id: json.data?.id ?? "", address, originChainId, originAsset: originSymbol } : null;
}

/** Register (or update) the deposit webhook URL + events with Dextopus. */
export async function configureWebhook(webhookUrl: string): Promise<boolean> {
  const cfg = dextopusConfig();
  if (!cfg) return false;
  const res = await fetch(`${cfg.baseUrl}/deposit/static/webhook`, {
    method: "POST",
    headers: { "x-api-key": cfg.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      webhookUrl,
      events: ["deposit.created", "deposit.completed", "deposit.failed", "deposit.refunded"],
    }),
  });
  return res.ok;
}
