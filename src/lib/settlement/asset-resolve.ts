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

  // 2. A contract address. Ask the provider's own catalogue what it is. This is
  //    the case our settlement config actually produces.
  if (looksLikeTokenAddress(raw)) {
    const symbol = await symbolForTokenAddress(raw, chainId).catch(() => undefined);
    if (symbol && isListedAsset(symbol)) return canonical(symbol);
    // A known address we don't list (some random token someone sent) must NOT
    // be credited — falling through to review is the correct ending.
    return null;
  }

  // 3. A ticker with the network glued on: USDT_TRON, USDC.e, USDT-BEP20.
  //    Only the first segment can be the ticker, and it still has to be listed —
  //    so this widens what we recognise without inventing assets.
  const head = upper.split(/[._\-/]/)[0];
  if (head && head !== upper && isListedAsset(head)) return canonical(head);

  return null;
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
