import { PLATFORM_MARGIN_PCT, COLLECTION_FEE_PCT } from "./constants";
import { collectionFeePct as feeForCurrency } from "./fees";

// The per-currency fee schedule lives in ./fees so it can be unit-tested and
// shared with the client. Re-exported here so existing importers keep working.
export { providerTransferFee, transferFee, transferFeeMarkup } from "./fees";

/**
 * The collection (buy) fee we net out so the provider's cut never eats margin.
 * Per-currency: Flutterwave charges different collection rates by country, so
 * `COLLECTION_FEE_PCT_<CODE>` overrides the global default for that currency.
 */
export function collectionFeePct(currency = "NGN"): number {
  return feeForCurrency(currency, COLLECTION_FEE_PCT);
}

/**
 * Competitive pricing engine.
 *
 * Users are quoted the live market/P2P *reference* rate minus a thin margin —
 * so Ttip tracks the Bybit-P2P rate automatically and always looks sharp — and
 * the margin is captured as spread revenue. All pure math: the live reference
 * rate is fetched elsewhere (prices.ts) and passed in, so this stays testable.
 */

/** The active platform margin (env override, else the default). */
export function platformMargin(): number {
  const v = Number(process.env.PLATFORM_MARGIN_PCT);
  return Number.isFinite(v) && v >= 0 && v < 0.5 ? v : PLATFORM_MARGIN_PCT;
}

export interface Quote {
  asset: string; // e.g. USDT
  fiat: string; // e.g. NGN
  side: "sell" | "buy"; // sell = crypto→fiat (off-ramp); buy = fiat→crypto (on-ramp)
  amountAsset: number;
  marketRate: number; // fiat per 1 unit of asset (reference/P2P)
  userRate: number; // fiat per 1 unit of asset offered to the user
  marginPct: number;
  marketFiat: number; // fiat value at the market rate (what we clear at)
  userFiat: number; // fiat the user receives (sell) or pays (buy)
  spreadFiat: number; // platform revenue on this trade (always ≥ 0)
}

/**
 * Quote an off-ramp (crypto → fiat). The user receives `marketRate × (1−margin)`
 * per unit; we clear the crypto at ~`marketRate`; the difference is our spread.
 */
export function quoteSell(params: {
  asset: string;
  fiat: string;
  amountAsset: number;
  marketRate: number;
  marginPct?: number;
}): Quote {
  const marginPct = params.marginPct ?? platformMargin();
  const userRate = params.marketRate * (1 - marginPct);
  const marketFiat = params.amountAsset * params.marketRate;
  const userFiat = params.amountAsset * userRate;
  return {
    asset: params.asset,
    fiat: params.fiat,
    side: "sell",
    amountAsset: params.amountAsset,
    marketRate: params.marketRate,
    userRate,
    marginPct,
    marketFiat,
    userFiat,
    spreadFiat: marketFiat - userFiat,
  };
}

/**
 * Quote an on-ramp (fiat → crypto). The user pays `marketRate × (1+margin)` per
 * unit; we source the crypto at ~`marketRate`; the difference is our spread.
 */
export function quoteBuy(params: {
  asset: string;
  fiat: string;
  amountAsset: number;
  marketRate: number;
  marginPct?: number;
}): Quote {
  const marginPct = params.marginPct ?? platformMargin();
  const userRate = params.marketRate * (1 + marginPct);
  const marketFiat = params.amountAsset * params.marketRate;
  const userFiat = params.amountAsset * userRate;
  return {
    asset: params.asset,
    fiat: params.fiat,
    side: "buy",
    amountAsset: params.amountAsset,
    marketRate: params.marketRate,
    userRate,
    marginPct,
    marketFiat,
    userFiat,
    spreadFiat: userFiat - marketFiat,
  };
}
