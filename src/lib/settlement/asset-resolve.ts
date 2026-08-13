import "server-only";
import { CRYPTO_BY_SYMBOL, FIAT_BY_CODE } from "../constants";
import { symbolForTokenAddress } from "./dextopus";

/**
 * Turning what the provider calls an asset into a ticker we can bank.
 *
 * PROVEN, not inferred. A trace of a real held deposit read:
 *
 *   0.15  EPJFWDD5AUFQSSQEM2QN1XZYBAPC8G4WEGGKZWYT
 *   HELD — refused by the asset guard, never credited
 *
 * That string is the Solana USDC mint, upper-cased. Dextopus reports the
 * settlement asset as a MINT/CONTRACT ADDRESS, our parser then shouted it, and
 * the guard asked "is EPJFWDD5… a listed ticker?", got no, and held the
 * deposit. The webhook arrived, the row was written, the money was never
 * credited — which is precisely "it reached the treasury and never showed up".
 *
 * Refusing to credit an unrecognised asset is right. Refusing to RECOGNISE our
 * own settlement mint is the bug.
 */

/** Mints and contracts we settle to. No network call, so an outage can't hold a good deposit. */
const KNOWN_TOKENS: Record<string, string> = {
  // Solana
  epjfwdd5aufqssqem2qn1xzybapc8g4weggkzwytdt1v: "USDC",
  es9vmfrzacermjfrf4h2fyd4kconky11mcce8benwnyb: "USDT",
  // EVM — USDC
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "USDC", // Ethereum
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": "USDC", // Base
  "0xaf88d065e77c8cc2239327c5edb3a432268e5831": "USDC", // Arbitrum
  "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": "USDC", // Polygon
  "0x0b2c639c533813f4aa9d7837caf62653d097ff85": "USDC", // Optimism
  // EVM — USDT
  "0xdac17f958d2ee523a2206206994597c13d831ec7": "USDT", // Ethereum
  "0x55d398326f99059ff775485246999027b3197955": "USDT", // BNB Chain
  "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9": "USDT", // Arbitrum
  tr7nhqjekqxgtci8q8zy4pl8otszgjlj6t: "USDT", // Tron
};

/** Placeholders meaning "the chain's own coin" — they appear in no token list. */
const NATIVE_ANY_CHAIN: Record<string, string> = {
  "11111111111111111111111111111111": "SOL", // Solana System Program
  so11111111111111111111111111111111111111112: "SOL", // wrapped SOL
};

const EVM_NATIVE = new Set([
  "0x0000000000000000000000000000000000000000",
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
]);

/** 0x000…0 is ETH on Ethereum, BNB on BNB Chain, POL on Polygon — chain decides. */
const EVM_NATIVE_BY_CHAIN: Record<number, string> = {
  1: "ETH", 10: "ETH", 56: "BNB", 137: "MATIC", 8453: "ETH", 42161: "ETH", 43114: "AVAX",
};

export function isListedAsset(symbol: string): boolean {
  const s = (symbol ?? "").trim().toUpperCase();
  if (!s) return false;
  return Boolean(
    CRYPTO_BY_SYMBOL[s as keyof typeof CRYPTO_BY_SYMBOL] || FIAT_BY_CODE[s as keyof typeof FIAT_BY_CODE],
  );
}

/**
 * Long enough to be an on-chain identifier rather than a ticker.
 *
 * Case-insensitive on purpose: by the time an asset reaches here its case has
 * usually been destroyed, and the strict per-chain patterns assume it intact.
 * The longest ticker we list is four characters.
 */
export function couldBeAddress(v: string): boolean {
  const s = (v ?? "").trim();
  if (/^0[xX][a-fA-F0-9]{40}$/.test(s)) return true;
  return s.length >= 26 && /^[A-Za-z0-9]+$/.test(s);
}

/** The canonical ticker, or null when it genuinely cannot be identified. */
export async function resolveDepositAsset(asset: string, chainId?: number): Promise<string | null> {
  const raw = (asset ?? "").trim();
  if (!raw) return null;

  const upper = raw.toUpperCase();
  if (isListedAsset(upper)) return canonical(upper);

  // Addresses we know, checked case-insensitively and BEFORE any shape test —
  // the shouted form of a base58 mint fails a strict base58 pattern.
  const lower = raw.toLowerCase();
  const known = KNOWN_TOKENS[lower] ?? NATIVE_ANY_CHAIN[lower];
  if (known && isListedAsset(known)) return canonical(known);

  if (EVM_NATIVE.has(lower)) {
    const native = chainId ? EVM_NATIVE_BY_CHAIN[chainId] : undefined;
    // No chain, no answer. Crediting the wrong coin is worse than holding.
    return native && isListedAsset(native) ? canonical(native) : null;
  }

  if (couldBeAddress(raw)) {
    const symbol = await symbolForTokenAddress(raw, chainId).catch(() => undefined);
    if (symbol && isListedAsset(symbol)) return canonical(symbol);
    return null;
  }

  // A ticker with the network glued on: USDT_TRON, USDC.e, USDT-BEP20.
  const head = upper.split(/[._\-/]/)[0];
  if (head && head !== upper && isListedAsset(head)) return canonical(head);

  return null;
}

/** The symbol in our own casing, so balances never split into two rows. */
function canonical(symbol: string): string {
  const s = symbol.toUpperCase();
  return (
    CRYPTO_BY_SYMBOL[s as keyof typeof CRYPTO_BY_SYMBOL]?.symbol ??
    FIAT_BY_CODE[s as keyof typeof FIAT_BY_CODE]?.code ??
    s
  );
}
