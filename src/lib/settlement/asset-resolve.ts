import "server-only";
import { CRYPTO_BY_SYMBOL, FIAT_BY_CODE } from "../constants";
import { looksLikeTokenAddress, symbolForTokenAddress } from "./dextopus";

/**
 * Turning whatever a provider calls an asset into a ticker we can bank.
 *
 * A balance row is keyed by its symbol, so whatever lands in `deposit.asset`
 * becomes the line on someone's home screen. Providers do not send clean
 * tickers. Three shapes turn up:
 *
 *   "USDT"                                        — already a ticker
 *   "USDT_TRON", "USDC.e", "USDT-BEP20"           — ticker with the chain glued on
 *   "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"  — the token CONTRACT ADDRESS
 *
 * The third is not a hypothetical. Our own Dextopus settlement assets are
 * CONFIGURED as contract addresses — Ethereum USDC is `0xa0b8…`, Tron USDT is
 * `TR7N…` — and Dextopus echoes that address straight back on the webhook. A
 * deposit arriving that way is a real deposit of a real listed asset that
 * simply hasn't been named yet.
 *
 * Refusing to credit it is right; refusing to RECOGNISE it is what made a
 * user's USDT vanish. So the name is resolved first, and only something that
 * still can't be identified is held for review.
 */

/**
 * The stablecoin contracts we settle to, by address.
 *
 * The catalogue lookup below is the general answer, but it depends on a network
 * call that can fail or come back empty — and when it does, a real deposit goes
 * back to being held. These are the handful of addresses our own settlement
 * config actually uses, so the common case resolves with no network at all.
 *
 * Lowercased keys: EVM addresses arrive in wildly different casing.
 */
const KNOWN_TOKENS: Record<string, string> = {
  // USDC
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "USDC", // Ethereum
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": "USDC", // Base
  "0xaf88d065e77c8cc2239327c5edb3a432268e5831": "USDC", // Arbitrum
  "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": "USDC", // Polygon
  "0x0b2c639c533813f4aa9d7837caf62653d097ff85": "USDC", // Optimism
  epjfwdd5aufqssqem2qn1xzybapc8g4weggkzwytdt1v: "USDC", // Solana
  // USDT
  "0xdac17f958d2ee523a2206206994597c13d831ec7": "USDT", // Ethereum
  tr7nhqjekqxgtci8q8zy4pl8otszgjlj6t: "USDT", // Tron
  "0x55d398326f99059ff775485246999027b3197955": "USDT", // BNB Chain
  "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9": "USDT", // Arbitrum
  es9vmfrzacermjfrf4h2fyd4kconky11mcce8benwnyb: "USDT", // Solana
};

/**
 * Placeholders that mean "the chain's own coin" rather than a listed token.
 *
 * These never appear in the token catalogue, so no lookup will ever find them.
 * A native SOL deposit arrives as the Solana System Program id — 32 ones — and
 * without this it resolves to nothing and the deposit is held for ever.
 *
 * Split in two on purpose. The Solana ids name exactly one coin, so they are
 * safe to resolve on sight. The EVM ones do NOT: `0x000…0` means ETH on
 * Ethereum, BNB on BNB Chain and POL on Polygon, so they are only safe with the
 * chain in hand. Guessing ETH there would credit the wrong asset, which is
 * worse than holding — so an EVM placeholder with no chain stays held.
 */
const NATIVE_ANY_CHAIN: Record<string, string> = {
  "11111111111111111111111111111111": "SOL", // Solana System Program
  so11111111111111111111111111111111111111112: "SOL", // wrapped SOL
};

const EVM_NATIVE_PLACEHOLDER = new Set([
  "0x0000000000000000000000000000000000000000",
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
]);

/** The coin that pays gas on each EVM chain we settle through. */
const EVM_NATIVE_BY_CHAIN: Record<number, string> = {
  1: "ETH", // Ethereum
  10: "ETH", // Optimism
  56: "BNB", // BNB Chain
  137: "MATIC", // Polygon
  8453: "ETH", // Base
  42161: "ETH", // Arbitrum
  43114: "AVAX", // Avalanche
};

/** Is this already a listed ticker — BTC, USDC, NGN — exactly as written? */
export function isListedAsset(symbol: string): boolean {
  const s = (symbol ?? "").trim().toUpperCase();
  if (!s) return false;
  return Boolean(
    CRYPTO_BY_SYMBOL[s as keyof typeof CRYPTO_BY_SYMBOL] || FIAT_BY_CODE[s as keyof typeof FIAT_BY_CODE],
  );
}

/**
 * The canonical ticker for whatever a provider called this asset, or null if it
 * genuinely cannot be identified.
 *
 * Returns the symbol in the exact case our asset tables use, because the value
 * returned here is what the balance gets keyed by — "usdt" and "USDT" are two
 * different wallet rows, and only one of them is real.
 */
export async function resolveDepositAsset(asset: string, chainId?: number): Promise<string | null> {
  const raw = (asset ?? "").trim();
  if (!raw) return null;

  // 1. Already a ticker.
  const upper = raw.toUpperCase();
  if (isListedAsset(upper)) return canonical(upper);

  // 2. An address we know by heart.
  //
  //    Checked BEFORE any judgement about the string's shape, and always
  //    case-insensitively, because by the time an asset reaches here its case
  //    has usually been destroyed. The webhook uppercases the settlement asset,
  //    which turns `0xa0b8…` into `0XA0B8…` and a Tron address into one
  //    containing letters base58 does not use — so a shape test run first
  //    rejects real addresses, and the deposit is held. That is exactly what
  //    was happening, and rows already written that way still have to resolve.
  const lower = raw.toLowerCase();

  const known = KNOWN_TOKENS[lower];
  if (known && isListedAsset(known)) return canonical(known);

  const nativeAnywhere = NATIVE_ANY_CHAIN[lower];
  if (nativeAnywhere && isListedAsset(nativeAnywhere)) return canonical(nativeAnywhere);

  if (EVM_NATIVE_PLACEHOLDER.has(lower)) {
    const native = chainId ? EVM_NATIVE_BY_CHAIN[chainId] : undefined;
    // No chain, no answer. `0x000…0` is ETH, BNB or POL depending on where it
    // came from, and crediting the wrong one is worse than holding it.
    return native && isListedAsset(native) ? canonical(native) : null;
  }

  // 3. Some other contract address — ask the provider's own catalogue.
  //    `couldBeAddress` is deliberately loose: no ticker we list is anywhere
  //    near this long, so the only cost of asking is a cache lookup, and the
  //    catalogue answers undefined for anything it doesn't know.
  if (couldBeAddress(raw)) {
    const symbol = await symbolForTokenAddress(raw, chainId).catch(() => undefined);
    if (symbol && isListedAsset(symbol)) return canonical(symbol);
    // An address we can't name must NOT be credited — held is the right ending.
    return null;
  }

  // 4. A ticker with the network glued on: USDT_TRON, USDC.e, USDT-BEP20.
  //    Only the first segment can be the ticker, and it still has to be listed —
  //    so this widens what we recognise without inventing assets.
  const head = upper.split(/[._\-/]/)[0];
  if (head && head !== upper && isListedAsset(head)) return canonical(head);

  return null;
}

/**
 * Long enough to be an on-chain identifier rather than a ticker.
 *
 * Case-insensitive and forgiving on purpose. The strict per-chain patterns
 * elsewhere assume the original casing, which webhooks do not preserve; the
 * longest ticker we list is four characters, so anything this long is not one.
 */
export function couldBeAddress(v: string): boolean {
  const s = v.trim();
  if (/^0[xX][a-fA-F0-9]{40}$/.test(s)) return true; // EVM, either case
  return s.length >= 26 && /^[A-Za-z0-9]+$/.test(s); // base58 / bech32-ish
}

/** The symbol in the case our own tables use, so balances never split in two. */
function canonical(symbol: string): string {
  const s = symbol.toUpperCase();
  return (
    CRYPTO_BY_SYMBOL[s as keyof typeof CRYPTO_BY_SYMBOL]?.symbol ??
    FIAT_BY_CODE[s as keyof typeof FIAT_BY_CODE]?.code ??
    s
  );
}
