import { GOVERNMENT_ID_TYPES } from "../constants";

/**
 * Work out a user's KYC tier from the identity documents they have actually
 * verified. Kept dependency-free so it's unit-testable.
 *
 * The tier is always DERIVED, never granted directly. The old code did
 * `kycTier: Math.max(2, result.tier)`, so verifying a BVN — which only proves
 * the person is bank-verified — jumped straight to Tier 2 and its ₦5,000,000
 * daily limit. Each rung now has to be earned:
 *
 *   1  BVN
 *   2  BVN + any government ID (NIN, passport, driver's licence)
 *   3  the above + proof of address
 */
export function tierFor(idTypes: readonly string[]): number {
  const have = new Set(idTypes.map((t) => t.toLowerCase()));
  if (!have.has("bvn")) return 0; // BVN is the floor — nothing below it withdraws
  const hasGovId = GOVERNMENT_ID_TYPES.some((t) => have.has(t));
  if (!hasGovId) return 1;
  return have.has("address") ? 3 : 2;
}

/** Add a newly verified id type to the set, preserving order and uniqueness. */
export function withIdType(existing: readonly string[], idType: string): string[] {
  const t = idType.toLowerCase();
  return existing.includes(t) ? [...existing] : [...existing, t];
}
