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

/**
 * The provider's cap on a percentage collection fee, in that currency.
 *
 * Flutterwave caps NGN collections at ₦2,000 however large the transfer, so
 * charging a flat percentage on a ₦1,000,000 deposit would bill the user
 * ₦15,000 against a ₦2,000 cost. Override per currency with
 * `COLLECTION_FEE_CAP_<CODE>`; `0` means genuinely uncapped.
 *
 * CONFIRM BOTH the rate and this cap against your own Flutterwave contract —
 * the defaults are Flutterwave's published Nigerian pricing, not your rate card.
 */
export function collectionFeeCap(currency: string): number | null {
  const raw = process.env[`COLLECTION_FEE_CAP_${(currency ?? "").toUpperCase()}`];
  if (raw !== undefined) {
    const v = Number(raw);
    if (Number.isFinite(v) && v >= 0) return v > 0 ? v : null;
  }
  return (currency ?? "").toUpperCase() === "NGN" ? 2000 : null;
}

/** What the provider actually bills US to collect `amountFiat`. */
export function providerCollectionFee(amountFiat: number, currency: string, pct: number): number {
  if (!(amountFiat > 0)) return 0;
  const raw = amountFiat * pct;
  const cap = collectionFeeCap(currency);
  return cap === null ? raw : Math.min(raw, cap);
}

/**
 * Markup on top of the provider's collection cost. DEFAULT 0 — recover the
 * cost, don't profit on it.
 *
 * A deposit fee is the one charge levied at the moment someone is trying to
 * GIVE you money, and it's the gateway to every other stream: that ₦10,000,
 * once swapped, earns ~1.8% spread — many times the cost of collecting it.
 * Marking the collection up taxes the thing you want more of.
 */
export function depositFeeMarkup(): number {
  const raw = Number(process.env.DEPOSIT_FEE_MARKUP);
  return Number.isFinite(raw) && raw >= 0 ? raw : 0;
}

/**
 * A FLAT deposit fee, which is how dedicated virtual accounts are usually
 * billed — a fixed amount per inflow, not a percentage. When set, it replaces
 * the percentage entirely.
 *
 * `DEPOSIT_FEE_FLAT_<CODE>`, e.g. DEPOSIT_FEE_FLAT_NGN=50. Set it to 0 to make
 * deposits free.
 */
export function depositFeeFlat(currency: string): number | null {
  const raw = process.env[`DEPOSIT_FEE_FLAT_${(currency ?? "").toUpperCase()}`];
  if (raw === undefined) return null;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : null;
}

/**
 * The fee charged on a fiat DEPOSIT — the provider's real cost plus our markup,
 * exactly the shape the bank-transfer payout fee uses.
 *
 * Without this a naira deposit credited the full amount while Flutterwave still
 * billed us ~1.5% of it, so every single deposit drained the float. This is a
 * separate cost from the ~1.8% trading spread and has to be recovered
 * separately — the spread is what we earn for converting, not a subsidy for the
 * provider's collection charge.
 *
 * Never exceeds the deposit itself, so a tiny deposit can't go negative.
 */
export function depositFee(amountFiat: number, currency: string, pct: number): number {
  if (!(amountFiat > 0)) return 0;

  // A flat fee, when configured, wins — it's how virtual-account inflows are
  // actually billed, and it's what users expect from a Nigerian bank transfer.
  const flat = depositFeeFlat(currency);
  if (flat !== null) return Math.min(flat, amountFiat);

  const cost = providerCollectionFee(amountFiat, currency, pct);
  const withMarkup = Math.ceil(cost * (1 + depositFeeMarkup()));
  return Math.min(withMarkup, amountFiat);
}

/**
 * The deposit fee expressed as a rate + cap, for display.
 *
 * Resolved on the SERVER and handed to the client, because the per-currency
 * overrides are read with a computed key (`COLLECTION_FEE_PCT_${code}`) which
 * Next cannot inline into a client bundle — so a client computing this itself
 * would quote the default while the server charged the override. On a money
 * screen the quoted fee has to be the charged fee.
 */
export interface DepositFeeSchedule {
  /** Fraction of the deposit, markup included. 0 when a flat fee applies. */
  pct: number;
  /** Maximum fee in that currency, markup included; null when uncapped. */
  cap: number | null;
  /** A fixed fee per deposit, when configured. Overrides `pct`. */
  flat?: number;
}

export function depositFeeSchedule(currency: string, pct: number): DepositFeeSchedule {
  const flat = depositFeeFlat(currency);
  if (flat !== null) return { pct: 0, cap: null, flat };
  const markup = 1 + depositFeeMarkup();
  const cap = collectionFeeCap(currency);
  return { pct: pct * markup, cap: cap === null ? null : Math.ceil(cap * markup) };
}

/**
 * Service fee on a bill payment (airtime, data, electricity, TV, internet).
 *
 * Bills used to run at exactly zero margin — the crypto was debited at the pure
 * market rate with an explicit "no hidden markup", while we still carry the
 * provider's cost and the float. Every bill was work done for nothing.
 *
 * PRICING WARNING: Nigerian VTU apps compete hard here and several give a small
 * DISCOUNT on airtime rather than charging. A visible fee on a ₦100 recharge is
 * the most price-compared thing on the platform. Set BILL_FEE_PCT=0 to turn it
 * off, or lower it, if that trade isn't worth it.
 *
 * Rate: BILL_FEE_PCT (default 1%). Cap: BILL_FEE_CAP (default ₦100, 0 = none).
 */
export function billFeePct(): number {
  const v = Number(process.env.BILL_FEE_PCT);
  return Number.isFinite(v) && v >= 0 && v < 0.2 ? v : 0.01;
}

export function billFeeCap(): number | null {
  const raw = process.env.BILL_FEE_CAP;
  if (raw !== undefined) {
    const v = Number(raw);
    if (Number.isFinite(v) && v >= 0) return v > 0 ? v : null;
  }
  return 100;
}

/** The fee added on top of a bill's face value, in the bill currency. */
export function billFee(amountFiat: number): number {
  if (!(amountFiat > 0)) return 0;
  const cap = billFeeCap();
  const raw = amountFiat * billFeePct();
  return Math.ceil(cap === null ? raw : Math.min(raw, cap));
}

/**
 * Fee on a CRYPTO deposit, as a fraction. Default 0 — deliberately.
 *
 * The sweep provider (Dextopus) charges ~0.25% per transaction. Whether that is
 * already deducted from the amount they report to us is a question for their
 * contract, and it decides this number:
 *
 *   - if their fee IS netted off before the webhook, we credit what actually
 *     arrived and charging again would double-bill the user;
 *   - if it is NOT, we currently credit more than the treasury received, and
 *     this should be set to about 0.003 (their 0.25% plus markup).
 *
 * Confirm, then set CRYPTO_DEPOSIT_FEE_PCT. Guessing either way is a real cost
 * to somebody, so the default charges nothing.
 */
export function cryptoDepositFeePct(): number {
  const v = Number(process.env.CRYPTO_DEPOSIT_FEE_PCT);
  return Number.isFinite(v) && v >= 0 && v < 0.05 ? v : 0;
}

/**
 * Ttip's fee on a crypto withdrawal: 0.8%, with a $0.50 floor.
 *
 * A flat $0.50 was fair on a $60 send and a giveaway on a $10,000 one — the
 * work and the risk of a large withdrawal scale with the amount, and the fee
 * didn't. A pure percentage has the opposite problem: 0.8% of $5 is four cents,
 * which doesn't cover the cost of looking at it.
 *
 * So: whichever is larger. Flat $0.50 up to $62.50, then 0.8% above — the two
 * meet exactly at $62.50, so there is no step in the curve where sending one
 * dollar more suddenly costs less.
 *
 * Charged ON TOP of the real on-chain/provider fee, which the network deducts
 * separately.
 *
 * Dependency-free and shared with the client, because the fee the user is shown
 * before confirming has to be the exact fee the server charges.
 */
export function cryptoWithdrawFeePct(): number {
  const raw = (process.env.NEXT_PUBLIC_WITHDRAW_FEE_PCT ?? "").trim();
  const n = Number(raw);
  return raw !== "" && Number.isFinite(n) && n >= 0 && n < 0.1 ? n : 0.008;
}

export function cryptoWithdrawFeeMinUsd(): number {
  const raw = (process.env.NEXT_PUBLIC_WITHDRAW_FEE_MIN_USD ?? "").trim();
  const n = Number(raw);
  return raw !== "" && Number.isFinite(n) && n >= 0 ? n : 0.5;
}

/** The fee in USD for withdrawing `amountUsd` of crypto. */
export function cryptoWithdrawFeeUsd(amountUsd: number): number {
  if (!(amountUsd > 0)) return cryptoWithdrawFeeMinUsd();
  return Math.max(amountUsd * cryptoWithdrawFeePct(), cryptoWithdrawFeeMinUsd());
}

/** Where the percentage overtakes the floor — $62.50 at 0.8% / $0.50. */
export function cryptoWithdrawFeeBreakevenUsd(): number {
  const pct = cryptoWithdrawFeePct();
  return pct > 0 ? cryptoWithdrawFeeMinUsd() / pct : Infinity;
}

/**
 * The most that can be withdrawn from a balance, fee included.
 *
 * "Max" has to solve `amount + fee(amount) = balance`, and with a percentage
 * fee that is no longer "balance minus a constant". Get this wrong and tapping
 * Max always comes back one fee short — which is exactly the bug the bank-send
 * Max had before it did the same two-pass sum.
 *
 * Both branches are computed and the larger valid one wins, so the answer is
 * right on either side of the breakeven without a special case.
 */
export function maxCryptoWithdrawUsd(balanceUsd: number): number {
  if (!(balanceUsd > 0)) return 0;
  const min = cryptoWithdrawFeeMinUsd();
  const pct = cryptoWithdrawFeePct();

  // Two regimes, and exactly one of them is valid for a given balance — they
  // agree at the breakeven, so there is no gap and no overlap. Picking the
  // larger of the two (the obvious-looking shortcut) is wrong: below the
  // breakeven the proportional answer overstates, because the fee there is the
  // flat floor and not a percentage at all.
  const flat = balanceUsd - min;
  if (flat <= cryptoWithdrawFeeBreakevenUsd()) return flat > 0 ? flat : 0;
  return balanceUsd / (1 + pct);
}
