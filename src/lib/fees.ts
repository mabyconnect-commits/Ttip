/**
 * Provider fee schedule. Kept dependency-free (no server-only / Prisma imports)
 * so it's unit-testable AND usable from the client — the fee the user is shown
 * before confirming has to be the exact fee the server charges, so both sides
 * must run the same code with no API round-trip in between.
 *
 * Bank-transfer payout fees, from Flutterwave's published transfer pricing:
 * https://flutterwave.com/ke/support/pricing/pricing-for-transfers-and-payouts
 *
 *   NGN  ≤5,000 → ₦10 | ≤50,000 → ₦25 | above → ₦50
 *   GHS  ₵10 flat        KES  KSh100 flat      ZAR  R10 flat
 *   UGX  USh5,000 flat   TZS  TSh3,000 flat    RWF  FRw2,000 flat
 *
 * ZMW is deliberately absent: Flutterwave does not support Zambian BANK
 * payouts (mobile money only), so we can't settle one.
 *
 * Returning 0 for a currency we actually pay a fee on is a direct loss on every
 * withdrawal — the user is charged nothing while Flutterwave still bills us.
 * An unknown currency therefore returns null ("we can't price this"), never 0.
 */

/** Raw bank-transfer cost charged to US by the provider, in `currency`. */
export function providerTransferFee(amountFiat: number, currency: string): number | null {
  switch ((currency ?? "").toUpperCase()) {
    case "NGN":
      if (amountFiat <= 5000) return 10;
      if (amountFiat <= 50000) return 25;
      return 50;
    case "GHS":
      return 10;
    case "KES":
      return 100;
    case "ZAR":
      return 10;
    case "UGX":
      return 5000;
    case "TZS":
      return 3000;
    case "RWF":
      return 2000;
    default:
      return null; // not priced → caller must refuse, never charge 0
  }
}

/** The markup we add on top of the provider's cost (default 20%). */
export function transferFeeMarkup(): number {
  const raw = Number(process.env.TRANSFER_FEE_MARKUP);
  return Number.isFinite(raw) && raw >= 0 ? raw : 0.2;
}

/**
 * The transfer fee charged to the user: the provider's real cost plus our
 * markup, applied identically in every currency — naira has no special case.
 * Returns null when we can't price the currency, so the caller refuses the
 * payout instead of eating the provider's fee.
 */
export function transferFee(amountFiat: number, currency: string): number | null {
  const raw = providerTransferFee(amountFiat, currency);
  if (raw === null) return null;
  return Math.ceil(raw * (1 + transferFeeMarkup()));
}

/**
 * What the collection provider takes on a buy, as a fraction, per currency.
 *
 * Flutterwave's collection pricing differs by country and channel, so each
 * currency is overridable with `COLLECTION_FEE_PCT_<CODE>` (e.g.
 * COLLECTION_FEE_PCT_GHS=0.02). `COLLECTION_FEE_PCT` sets the global default.
 * Set these per country from your own Flutterwave dashboard — the default is
 * only a starting point, and a rate set too low is margin lost on every buy.
 */
export function collectionFeePct(currency: string, fallback: number): number {
  const per = Number(process.env[`COLLECTION_FEE_PCT_${(currency ?? "").toUpperCase()}`]);
  if (Number.isFinite(per) && per >= 0 && per < 0.2) return per;
  const global = Number(process.env.COLLECTION_FEE_PCT);
  if (Number.isFinite(global) && global >= 0 && global < 0.2) return global;
  return fallback;
}
