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
 * 3. ADDRESSES ARE MINTED PER FAMILY, NOT PER TOKEN. Each user gets one
 *    reusable address for EVM, one for Solana, one for Tron and one for
 *    Bitcoin, each minted through that family's canonical origin. Any
 *    chain+token the user picks inside a family resolves to that family's
 *    single address. Minting per (chain, token) is what fails on the non-EVM
 *    families — which is why Solana and Bitcoin never produced an address
 *    while EVM appeared to work.
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
  /**
   * How many base units make one token. THE most important field here and the
   * one we used to throw away — Dextopus reports settlement amounts in base
   * units, so without this a 0.725902 USDC deposit is credited as 725902.
   */
  decimals: number | null;
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
 * One address per family covers every chain and token in that family, so a user
 * has four addresses rather than one per asset. Overridable with
 * DEXTOPUS_CANONICAL_ORIGINS (JSON) if Dextopus ever reprices these routes.
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
      const dec = Number(t.decimals ?? t.decimal ?? t.tokenDecimals);
      tokens.push({
        symbol,
        address,
        name: String(t.name ?? symbol),
        decimals: Number.isInteger(dec) && dec >= 0 && dec <= 36 ? dec : null,
      });
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

/** A mint/contract address back to its ticker, via the provider's catalogue. */
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

/**
 * How many decimals a token uses, by contract address OR ticker.
 *
 * Dextopus sends settlement amounts in BASE UNITS, so this is what turns their
 * number into money. Asked of the provider's own catalogue rather than a table
 * we maintain, because the same ticker differs by chain — USDT is 6 decimals on
 * Tron and Ethereum and 18 on BNB Chain, which is exactly how one bug produced
 * both a mildly wrong balance and a ten-quintillion one.
 *
 * Returns null when it cannot be established. The caller must then decline to
 * credit rather than assume: assuming 6 where it is 18 is a factor of a
 * trillion.
 */
export async function tokenDecimals(addressOrSymbol: string, chainId?: number): Promise<number | null> {
  const needle = (addressOrSymbol ?? "").trim().toLowerCase();
  if (!needle) return null;
  const chains = await catalog();
  const search = chainId ? chains.filter((c) => c.chainId === chainId) : chains;
  for (const c of search.length ? search : chains) {
    const hit = c.tokens.find(
      (t) => t.address.toLowerCase() === needle || t.symbol.toLowerCase() === needle,
    );
    if (hit && hit.decimals != null) return hit.decimals;
  }
  return null;
}

/** An on-chain token identifier rather than a ticker. */
function looksLikeTokenAddress(v: string): boolean {
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

  // The family is what decides the address; the chain the user picked only
  // tells us which family they're in.
  const chains = await catalog();
  const chain = chains.find((c) => c.chainId === originChainId);
  const family = chainFamily(originChainId, chain?.name);
  const origin = canonicalOrigin(family);

  const settlementAsset = await resolveTokenAddress(cfg, cfg.settlementChainId, cfg.settlementAsset);
  if (!settlementAsset) {
    console.error("[dextopus] settlement asset did not resolve", cfg.settlementAsset, cfg.settlementChainId);
    return null;
  }

  // Reuse before minting: a user who cleared their record shouldn't collect a
  // second address for the same route, and Dextopus indexes by userId.
  const existing = await listUserAddresses(cfg, userId);
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

  const refundTo = refundFor(family, cfg);

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
    console.error("[dextopus] generate threw", e);
    return null;
  }

  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: { id?: string; depositAddress?: string };
    depositAddress?: string;
    message?: string;
    error?: string;
  };

  if (!res.ok || json.success === false) {
    // Logged loudly: this is the failure users see as "not available right
    // now", and without the provider's own message it's unguessable.
    console.error("[dextopus] generate failed", res.status, json.message ?? json.error ?? "", { family, originChainId });
    return null;
  }

  const address = json.data?.depositAddress ?? json.depositAddress;
  return address ? { id: json.data?.id ?? "", address, originChainId, originAsset: originSymbol } : null;
}

/**
 * Every deposit Dextopus has recorded for a user. THE missing backstop.
 *
 * Deposits were the only money flow here with a single delivery path: if the
 * webhook didn't arrive, or arrived and was rejected, the deposit simply never
 * existed as far as the app was concerned. Bills poll. Buys poll. Withdrawals
 * poll. Payouts poll. Deposits had nothing — one dropped HTTP request and the
 * user's money sat in treasury for ever.
 *
 * `GET /deposit/static/deposits?userId=` is the endpoint that fixes that, taken
 * from the Sweepflow integration where it is exactly what their UI reads.
 * Asking the provider what actually happened beats hoping a webhook lands.
 */
export async function listDeposits(params: { userId?: string; depositAddress?: string }): Promise<
  Record<string, unknown>[]
> {
  const cfg = dextopusConfig();
  if (!cfg) return [];
  const q = new URLSearchParams();
  if (params.userId) q.set("userId", params.userId);
  if (params.depositAddress) q.set("depositAddress", params.depositAddress);
  if (![...q.keys()].length) return [];

  try {
    const res = await fetch(`${cfg.baseUrl}/deposit/static/deposits?${q.toString()}`, {
      headers: { "x-api-key": cfg.apiKey },
    });
    if (!res.ok) {
      console.error("[dextopus] deposits list failed", res.status);
      return [];
    }
    const body = (await res.json().catch(() => null)) as { success?: boolean; data?: unknown } | null;
    if (!body || body.success === false) return [];
    return Array.isArray(body.data) ? (body.data as Record<string, unknown>[]) : [];
  } catch (e) {
    console.error("[dextopus] deposits list threw", e);
    return [];
  }
}

/**
 * Register (or update) the deposit webhook URL + events with Dextopus.
 *
 * This function existed for months and was called from NOWHERE. Which means
 * that unless someone registered the URL by hand in the dashboard, Dextopus had
 * no address to deliver deposit events to: every deposit settled into treasury
 * correctly and no webhook was ever fired, so the app never learned the money
 * had arrived. No settlement row, no transaction, nothing in any log — because
 * nothing was ever sent. It is now reachable from the admin panel.
 *
 * Returns the provider's own response, not just a boolean, because "it didn't
 * work" without their message is what makes this take a week instead of a
 * minute.
 */
export async function configureWebhook(
  webhookUrl: string,
): Promise<{ ok: boolean; status: number; body: string }> {
  const cfg = dextopusConfig();
  if (!cfg) return { ok: false, status: 0, body: "Dextopus is not configured on this deployment." };
  try {
    const res = await fetch(`${cfg.baseUrl}/deposit/static/webhook`, {
      method: "POST",
      headers: { "x-api-key": cfg.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        webhookUrl,
        events: ["deposit.created", "deposit.completed", "deposit.failed", "deposit.refunded"],
      }),
    });
    const body = await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, body: body.slice(0, 600) };
  } catch (e) {
    return { ok: false, status: 0, body: (e as Error).message };
  }
}

/** What Dextopus currently has registered, when they'll tell us. */
export async function readWebhookConfig(): Promise<{ status: number; body: string } | null> {
  const cfg = dextopusConfig();
  if (!cfg) return null;
  try {
    const res = await fetch(`${cfg.baseUrl}/deposit/static/webhook`, {
      headers: { "x-api-key": cfg.apiKey },
    });
    const body = await res.text().catch(() => "");
    return { status: res.status, body: body.slice(0, 600) };
  } catch (e) {
    return { status: 0, body: (e as Error).message };
  }
}
