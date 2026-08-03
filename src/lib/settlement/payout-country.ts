/**
 * Currency → country for provider lookups. Kept dependency-free (no server-only
 * / Prisma imports) so it's unit-testable, because getting this wrong sends real
 * money to the wrong country's banks.
 *
 * There is deliberately NO default. Falling back to "NG" for an unmapped
 * currency resolves the payout against **Nigerian** banks, so a Ugandan or
 * Zambian payout would land at whichever Nigerian bank fuzzy-matched the name.
 * Callers must treat `null` as "refuse this payout".
 *
 * XOF and XAF are deliberately absent: one currency spans many countries (XOF is
 * SN/CI/ML/BF/BJ/TG, XAF is CM/GA/TD/CF/CG/GQ), so the bank list can't be derived
 * from the currency alone. They need an explicit country on the request first.
 */
const PAYOUT_COUNTRY: Record<string, string> = {
  NGN: "NG",
  GHS: "GH",
  KES: "KE",
  ZAR: "ZA",
  UGX: "UG",
  TZS: "TZ",
  RWF: "RW",
  // ZMW is intentionally omitted: Flutterwave supports Zambian mobile money but
  // NOT bank payouts, and a bank account is the only destination Ttip settles
  // to. Listing it would take a withdrawal we can't complete.
};

/** Country code for a payout currency, or null when we can't safely infer one. */
export function payoutCountry(currency: string): string | null {
  return PAYOUT_COUNTRY[(currency ?? "").toUpperCase()] ?? null;
}

/** Whether bank payouts can be attempted in this currency at all. */
export function payoutCurrencySupported(currency: string): boolean {
  return payoutCountry(currency) !== null;
}
