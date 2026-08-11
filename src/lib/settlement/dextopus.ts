import "server-only";
import { dextopusConfig, type DextopusConfig } from "./config";

/**
 * Dextopus crypto-deposit provider — cross-chain settlement across 70+ networks,
 * non-custodial, ~0.25%/tx. A reusable per-user address is generated per origin
 * FAMILY; whatever the user sends is cross-chain-settled to your treasury
 * asset/address, and a signed webhook hits /api/webhooks/deposit.
 *
 * API: https://swap-api.dextopus.com/api  (auth: `x-api-key`)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Three things about this API that we had wrong, and that broke SOL and BTC:
 *
 * 1. THE CATALOG IS ONE CALL, NOT TWO. `GET /deposit/tokens` — with no
 *    parameters — returns `{ chains: [...] }`, and every chain carries its own
 *    token lists inline. There is no per-chain token endpoint to page through,
 *    so `/deposit/tokens?chainId=N` did not return what we assumed and the
 *    symbol→address map came back EMPTY. An empty map means resolveTokenAddress
 *    returns undefined, which means "asset not listed on that chain", which is
 *    exactly the "not available for deposit right now" users were hitting.
 *
 * 2. DEPOSITABLE TOKENS LIVE IN `solverCurrencies`. `featuredTokens` and
 *    `erc20Currencies` are catalog/display lists — they carry the logos but
 *    they are not the set you can actually mint an address for. Reading the
 *    wrong list gives you tokens that then fail at generate time.
 *
 * 3. ADDRESSES ARE MINTED PER ORIGIN, AND THE ORIGIN MATTERS. Minting per
 *    (chain, token) is what failed on the non-EVM families, which is why
 *    Solana and Bitcoin never produced an address; falling back to a per-family
 *    canonical origin fixed them. But applying that to EVM collapsed every EVM
 *    chain onto Ethereum — the address shown on the BNB Chain screen was the
 *    SAME string as the Ethereum one, registered to watch Ethereum USDC. Tokens
 *    sent on BNB Chain therefore landed at an address the provider wasn't
 *    watching for them, no webhook fired, and the deposit simply never arrived.
 *    So the chain the user picked is tried first and the family canonical is
 *    the fallback.
 *
 * The endpoint for minting is `POST /deposit/static/addresses` (we were posting
 * to /deposit/static/generate), and `GET /deposit/static/addresses?userId=`
 * lists what a user already has — so a lost local record is recovered instead
 * of minting a second address for the same tuple.
 */

export interface DextopusAddress {
  id: string;
  address: string;
  originChainId: number;
  originAsset: string;
}

export type ChainFamily = "evm" | "solana" | "tron" | "bitcoin";

export interface DxChain {
  chainId: number;
  name: string;
}

export interface DxToken {
  symbol: string;
  name: string;
}

interface CatalogToken {
  symbol: string;
  name: string;
  address: string;
}

interface CatalogChain {
  chainId: number;
  name: string;
  family: ChainFamily;
  supportsStaticAddress: boolean;
  tokens: CatalogToken[];
}

// ---- Families ---------------------------------------------------------------

/**
 * Dextopus gives the non-EVM networks synthetic numeric chain ids. These are
 * the well-known ones; anything else in the catalog is EVM. The name check is
 * the fallback, so a new Solana-family rollup (Eclipse) still classifies
 * correctly without a code change.
 */
const SOLANA_CHAIN_IDS = new Set([792703809, 9286185]);
const TRON_CHAIN_ID = 728126428;
const BITCOIN_CHAIN_ID = 8253038;

export function chainFamily(chainId: number, name = ""): ChainFamily {
  if (SOLANA_CHAIN_IDS.has(chainId)) return "solana";
  if (chainId === TRON_CHAIN_ID) return "tron";
  if (chainId === BITCOIN_CHAIN_ID) return "bitcoin";
  const n = name.toLowerCase();
  if (n.includes("solana") || n === "eclipse") return "solana";
  if (n.includes("tron")) return "tron";
  if (n.includes("bitcoin") || n.includes("btc")) return "bitcoin";
  return "evm";
}

/**
 * The origin each family's address is minted through.
 *
 * The FALLBACK origin, used when a chain can't be minted against directly.
 * Overridable with DEXTOPUS_CANONICAL_ORIGINS (JSON).
 *
 * Not the first choice any more: collapsing every EVM chain onto Ethereum is
 * what silently broke BNB Chain deposits.
 */
const DEFAULT_CANONICAL_ORIGIN: Record<ChainFamily, { chainId: number; asset: string }> = {
  evm: { chainId: 1, asset: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" }, // Ethereum USDC
  solana: { chainId: 792703809, asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" }, // Solana USDC
  tron: { chainId: 728126428, asset: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" }, // Tron USDT
  bitcoin: { chainId: 8253038, asset: "bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8" }, // Bitcoin BTC
};

function canonicalOrigin(family: ChainFamily): { chainId: number; asset: string } {
  try {
    const raw = process.env.DEXTOPUS_CANONICAL_ORIGINS;
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Record<ChainFamily, { chainId: number; asset: string }>>;
      const hit = parsed[family];
      if (hit?.chainId && hit?.asset) return hit;
    }
  } catch {
    /* malformed override — fall through to the defaults */
  }
  return DEFAULT_CANONICAL_ORIGIN[family];
}

/**
 * Where a refund goes if a deposit can't be settled — per family, because a
 * Bitcoin refund cannot land on an EVM address. Falls back to DEXTOPUS_REFUND_TO.
 * Omitted entirely when empty: the API rejects a blank refundTo.
 */
function refundFor(family: ChainFamily, cfg: DextopusConfig): string | null {
  const perFamily = {
    evm: process.env.DEXTOPUS_REFUND_EVM,
    solana: process.env.DEXTOPUS_REFUND_SOL,
    tron: process.env.DEXTOPUS_REFUND_TRON,
    bitcoin: process.env.DEXTOPUS_REFUND_BTC,
  }[family];
  return perFamily || (family === "evm" ? cfg.refundTo : null) || null;
}

// ---- Catalog ----------------------------------------------------------------

let catalogCache: { at: number; chains: CatalogChain[] } | null = null;
const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;

function asArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
}

/**
 * The whole chain + token catalog, in one request.
 *
 * Deliberately forgiving about the envelope — `{chains:[…]}`, `{data:[…]}` or a
 * bare array — and about which token list is present, so a shape change on
 * their side degrades rather than emptying the catalog and taking every deposit
 * address down with it.
 */
async function catalog(): Promise<CatalogChain[]> {
  const cfg = dextopusConfig();
  if (!cfg) return [];
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache.chains;

  let list: Record<string, unknown>[] = [];
  try {
    const res = await fetch(`${cfg.baseUrl}/deposit/tokens`, { headers: { "x-api-key": cfg.apiKey } });
    if (!res.ok) {
      console.error("[dextopus] catalog request failed", res.status);
      return catalogCache?.chains ?? [];
    }
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | unknown[] | null;
    list = Array.isArray(body) ? asArray(body) : asArray((body as Record<string, unknown>)?.chains ?? (body as Record<string, unknown>)?.data);
  } catch (e) {
    console.error("[dextopus] catalog threw", e);
    return catalogCache?.chains ?? [];
  }

  const chains: CatalogChain[] = [];
  for (const raw of list) {
    // A chain the provider has switched off can still appear in the catalog.
    if (raw.disabled === true || raw.depositEnabled === false) continue;

    const chainId = Number(raw.chainId ?? raw.id);
    const name = String(raw.name ?? raw.blockchain ?? "");
    if (!Number.isFinite(chainId) || !chainId || !name) continue;

    // solverCurrencies is what you can actually deposit. The others are
    // catalog/display lists and will happily offer you a token that then
    // fails at generate time.
    const source = raw.solverCurrencies ?? raw.tokens ?? raw.currencies;
    const tokens: CatalogToken[] = [];
    const seen = new Set<string>();
    for (const t of asArray(source)) {
      const symbol = String(t.symbol ?? "").toUpperCase();
      const address = String(t.address ?? t.contractAddress ?? t.mint ?? "");
      if (!symbol || !address || seen.has(symbol)) continue;
      seen.add(symbol);
      tokens.push({ symbol, address, name: String(t.name ?? symbol) });
    }
    if (!tokens.length) continue;

    chains.push({
      chainId,
      name,
      family: chainFamily(chainId, name),
      supportsStaticAddress: raw.supportsStaticAddress !== false,
      tokens,
    });
  }

  if (chains.length) catalogCache = { at: Date.now(), chains };
  return chains.length ? chains : (catalogCache?.chains ?? []);
}

/** Every chain we can mint a deposit address on (cached 6h). */
export async function listChains(): Promise<DxChain[]> {
  const chains = await catalog();
  return chains
    .filter((c) => c.supportsStaticAddress)
    .map((c) => ({ chainId: c.chainId, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The tokens depositable on a chain (cached 6h). */
export async function listTokens(chainId: number): Promise<DxToken[]> {
  const chains = await catalog();
  const hit = chains.find((c) => c.chainId === chainId);
  return sortForHumans(hit?.tokens ?? [], chainFamily(chainId, hit?.name)).map((t) => ({
    symbol: t.symbol,
    name: t.name,
  }));
}

/** The coin that pays for gas on each family — what the chain IS, to a user. */
const NATIVE_SYMBOL: Record<ChainFamily, string> = {
  solana: "SOL",
  evm: "ETH",
  tron: "TRX",
  bitcoin: "BTC",
};

/**
 * Order a chain's tokens the way someone looking for one would expect.
 *
 * The provider returns them in its own order, which put CASH, PYUSD and USDG
 * above SOL on Solana — so the chain's own coin was fifth in a list on a screen
 * headed "Choose an asset on solana". Native coin first, then the stablecoins
 * everybody actually moves, then the rest alphabetically.
 */
function sortForHumans<T extends { symbol: string }>(tokens: T[], family: ChainFamily): T[] {
  const native = NATIVE_SYMBOL[family];
  const rank = (symbol: string): number => {
    const s = symbol.toUpperCase();
    if (s === native) return 0;
    if (s === "USDC") return 1;
    if (s === "USDT") return 2;
    return 3;
  };
  return [...tokens].sort((a, b) => {
    const d = rank(a.symbol) - rank(b.symbol);
    return d !== 0 ? d : a.symbol.localeCompare(b.symbol);
  });
}

/**
 * Resolve an asset symbol to its Dextopus token address on a chain.
 *
 * Also accepts an address already: settlement assets are usually configured as
 * a contract address (Base USDC is `0x8335…`), and treating one as a symbol
 * would fail to resolve and silently disable every deposit.
 */
export async function resolveTokenAddress(
  _cfg: DextopusConfig,
  chainId: number,
  symbolOrAddress: string,
): Promise<string | undefined> {
  const value = (symbolOrAddress ?? "").trim();
  if (!value) return undefined;
  if (looksLikeTokenAddress(value)) return value;

  const chains = await catalog();
  const hit = chains.find((c) => c.chainId === chainId);
  return hit?.tokens.find((t) => t.symbol === value.toUpperCase())?.address;
}

/**
 * The reverse of `resolveTokenAddress`: a contract address back to its ticker.
 *
 * Settlement assets are configured as ADDRESSES (Ethereum USDC is `0xa0b8…`,
 * Tron USDT is `TR7N…`), and Dextopus echoes that address back on the webhook.
 * Crediting a balance keyed by it is what produced a wallet line literally named
 * after a contract, so the address has to become "USDC" before anything is
 * written down.
 *
 * `chainId` narrows the search when we know it; without it the same address is
 * looked for across every chain, which is safe because a contract address is
 * unique to its chain anyway.
 */
export async function symbolForTokenAddress(address: string, chainId?: number): Promise<string | undefined> {
  const needle = (address ?? "").trim().toLowerCase();
  if (!needle) return undefined;
  const chains = await catalog();
  const search = chainId ? chains.filter((c) => c.chainId === chainId) : chains;
  for (const c of search.length ? search : chains) {
    const hit = c.tokens.find((t) => t.address.toLowerCase() === needle);
    if (hit?.symbol) return hit.symbol.toUpperCase();
  }
  return undefined;
}

/** An on-chain token identifier rather than a ticker. */
export function looksLikeTokenAddress(v: string): boolean {
  if (/^0x[a-fA-F0-9]{40}$/.test(v)) return true; // EVM
  if (/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{20,}$/.test(v)) return true; // Bitcoin
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(v)) return true; // Tron
  // Solana mints are base58 and always longer than any ticker.
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) return true;
  return false;
}

// ---- Addresses --------------------------------------------------------------

interface ExistingAddress {
  id?: string;
  depositAddress?: string;
  originChainId?: number | string;
  originAsset?: string;
  settlementChainId?: number | string;
  settlementAsset?: string;
  settlementAddress?: string;
}

/** Every static address already minted for this user. */
async function listUserAddresses(cfg: DextopusConfig, userId: string): Promise<ExistingAddress[]> {
  try {
    const res = await fetch(`${cfg.baseUrl}/deposit/static/addresses?userId=${encodeURIComponent(userId)}`, {
      headers: { "x-api-key": cfg.apiKey },
    });
    if (!res.ok) return [];
    const body = (await res.json().catch(() => ({}))) as { success?: boolean; data?: unknown };
    if (body.success === false) return [];
    return Array.isArray(body.data) ? (body.data as ExistingAddress[]) : [];
  } catch {
    return [];
  }
}

const sameId = (a: unknown, b: unknown) => Number(a) === Number(b);
const sameAddr = (a: unknown, b: unknown) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();

/**
 * The user's reusable deposit address for the FAMILY that `originChainId`
 * belongs to. Anything they send on any chain in that family lands here.
 *
 * Returns null when Dextopus isn't configured or the settlement target can't be
 * resolved — never a half-built address, because an address we can't settle
 * from is money we can't credit.
 */
export async function createDepositAddress(
  userId: string,
  originChainId: number,
  originSymbol: string,
): Promise<DextopusAddress | null> {
  const cfg = dextopusConfig();
  if (!cfg || cfg.settlementChainId == null || !cfg.settlementAsset || !cfg.settlementAddress) return null;

  // Which origin to register the address against.
  //
  // This used to be the family's canonical origin, always — EVM meant Ethereum
  // USDC no matter which EVM chain the user picked. That is why per-family
  // minting fixed Solana and Bitcoin and quietly broke BNB Chain: the address
  // shown on the BNB screen was the SAME string as the Ethereum one, registered
  // to watch Ethereum, so tokens sent on BNB landed at an address the provider
  // was not watching for them and no webhook ever fired.
  //
  // So the chain the user actually picked is tried FIRST, and the family
  // canonical is kept as the fallback — if a chain genuinely can't be minted
  // against directly, behaviour is exactly what it was before.
  const chains = await catalog();
  const chain = chains.find((c) => c.chainId === originChainId);
  const family = chainFamily(originChainId, chain?.name);
  const fallback = canonicalOrigin(family);

  const settlementAsset = await resolveTokenAddress(cfg, cfg.settlementChainId, cfg.settlementAsset);
  if (!settlementAsset) {
    console.error("[dextopus] settlement asset did not resolve", cfg.settlementAsset, cfg.settlementChainId);
    return null;
  }

  // EVM ONLY. Solana, Tron and Bitcoin each have exactly one chain, so their
  // canonical origin already IS the chain the user picked — and minting them
  // per (chain, token) is the thing that failed and left them with no address
  // at all. They keep the path that works, untouched.
  const exact =
    family === "evm" && originChainId !== fallback.chainId
      ? await resolveTokenAddress(cfg, originChainId, originSymbol).catch(() => undefined)
      : undefined;
  const candidates: { chainId: number; asset: string }[] = [];
  if (exact) candidates.push({ chainId: originChainId, asset: exact });
  if (!candidates.some((c) => sameId(c.chainId, fallback.chainId) && sameAddr(c.asset, fallback.asset))) {
    candidates.push(fallback);
  }

  const refundTo = refundFor(family, cfg);

  // Reuse before minting, PER CANDIDATE and in order.
  //
  // The check and the mint have to be interleaved. Doing every reuse check
  // first is what quietly reinstated the bug: once any EVM address existed, the
  // fallback candidate matched it and every other EVM chain was handed that
  // same Ethereum-registered address again. The chain the user picked has to be
  // fully exhausted — look for one, then mint one — before the fallback is even
  // considered.
  const existing = await listUserAddresses(cfg, userId);

  let json: {
    success?: boolean;
    data?: { id?: string; depositAddress?: string };
    depositAddress?: string;
    message?: string;
    error?: string;
  } = {};

  for (const origin of candidates) {
    const match = existing.find(
      (a) =>
        a.depositAddress &&
        sameId(a.originChainId, origin.chainId) &&
        sameAddr(a.originAsset, origin.asset) &&
        sameId(a.settlementChainId, cfg.settlementChainId) &&
        sameAddr(a.settlementAsset, settlementAsset) &&
        sameAddr(a.settlementAddress, cfg.settlementAddress),
    );
    if (match?.depositAddress) {
      return { id: match.id ?? "", address: match.depositAddress, originChainId, originAsset: originSymbol };
    }

    let res: Response;
    try {
      res = await fetch(`${cfg.baseUrl}/deposit/static/addresses`, {
        method: "POST",
        headers: { "x-api-key": cfg.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          originChainId: origin.chainId,
          originAsset: origin.asset,
          settlementChainId: cfg.settlementChainId,
          settlementAsset,
          settlementAddress: cfg.settlementAddress,
          // Only when we actually have one — a blank refundTo is rejected.
          ...(refundTo ? { refundTo } : {}),
          metadata: { source: "ttip", family },
        }),
      });
    } catch (e) {
      console.error("[dextopus] generate threw", e, { triedChainId: origin.chainId });
      continue;
    }

    json = (await res.json().catch(() => ({}))) as typeof json;
    if (res.ok && json.success !== false && (json.data?.depositAddress ?? json.depositAddress)) break;

    // Logged loudly: this is the failure users see as "not available right
    // now", and without the provider's own message it's unguessable.
    console.error("[dextopus] generate failed", res.status, json.message ?? json.error ?? "", {
      family,
      triedChainId: origin.chainId,
    });
    json = {};
  }

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
