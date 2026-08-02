import { convert } from "./prices";
import { p2pUsdtRate } from "./p2p";

/**
 * Market reference rate for crypto↔fiat — the price we build every buy/sell quote
 * on top of.
 *
 * Primary source: **live P2P** (Binance → Bybit), the real street/parallel rate.
 * We take the USDT↔fiat mid and price any asset as `assetInUSDT × p2pRate`.
 *
 * Fallback (Bybit unreachable): official FX from prices.ts, lifted by a
 * configurable **P2P premium** so it still approximates the street rate. Set it
 * with `P2P_PREMIUM_PCT` or per-currency `P2P_PREMIUM_<CODE>` (e.g.
 * `P2P_PREMIUM_NGN=0.03`). Default 0.
 */

/** The P2P premium for a fiat, as a fraction (0 = use official rate as-is). */
export function p2pPremium(fiat: string): number {
  const per = Number(process.env[`P2P_PREMIUM_${fiat.toUpperCase()}`]);
  if (Number.isFinite(per) && per >= 0) return per;
  const global = Number(process.env.P2P_PREMIUM_PCT);
  return Number.isFinite(global) && global >= 0 ? global : 0;
}

/** Fiat value of `amount` crypto at the live reference (Bybit P2P, else FX). */
export async function referenceFiat(amount: number, asset: string, fiat: string): Promise<number> {
  const usdtRate = await p2pUsdtRate(fiat);
  if (usdtRate && usdtRate > 0) {
    const inUsdt = asset.toUpperCase() === "USDT" ? amount : await convert(amount, asset, "USDT");
    if (inUsdt > 0) return inUsdt * usdtRate;
  }
  // Fallback: official FX lifted by the configured P2P premium.
  const official = await convert(amount, asset, fiat);
  return official * (1 + p2pPremium(fiat));
}

/** Reference rate: fiat per 1 unit of the asset. */
export async function referenceRate(asset: string, fiat: string): Promise<number> {
  return referenceFiat(1, asset, fiat);
}
