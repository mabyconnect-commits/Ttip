/**
 * Corporate identity for the Ttip product.
 *
 * Ttip is a product operated by JENNMEC SOLUTIONS LTD. This single source feeds
 * the site footer and the Terms/Privacy pages so the registered company is
 * clearly linked to the product — required for payment-provider onboarding
 * (Monnify, Paystack) and app-store review.
 *
 * Fill RC_NUMBER and REGISTERED_ADDRESS once you have them; the pages render
 * those lines only when set, so leaving them blank never shows a placeholder.
 */
export const COMPANY = {
  product: "Ttip",
  legalName: "JENNMEC SOLUTIONS LTD",
  country: "Nigeria",
  domain: "ttip.site",
  supportEmail: "support@ttip.site",
  // Optional — set when available (shown on the legal pages if present).
  rcNumber: "" as string, // e.g. "RC 1234567"
  registeredAddress: "" as string, // e.g. "12 Example Ave, Lagos, Nigeria"
} as const;

/** "Ttip is a product of JENNMEC SOLUTIONS LTD" */
export const PRODUCT_OF = `${COMPANY.product} is a product of ${COMPANY.legalName}`;

/** Effective date shown on the legal pages. */
export const LEGAL_EFFECTIVE = "August 2026";
