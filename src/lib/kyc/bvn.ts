import "server-only";
import crypto from "crypto";

/**
 * BVN identity binding.
 *
 * A BVN is sensitive PII, so we don't store it in the clear. Instead we keep a
 * keyed, non-reversible fingerprint (HMAC-SHA256) plus the last 4 digits:
 *   - the fingerprint is UNIQUE per account, so one BVN can verify exactly one
 *     Ttip account (anti-reuse) and lets support trace a BVN back to its owner
 *     (hash the BVN in question, look it up);
 *   - the last 4 give a human-readable reference ("BVN ••1234") without exposing
 *     the full number.
 *
 * Keyed with BVN_HASH_SECRET (falls back to AUTH_SECRET). The key must stay
 * stable — changing it re-fingerprints every BVN and breaks matching.
 */
function secret(): string {
  return process.env.BVN_HASH_SECRET || process.env.AUTH_SECRET || "ttip-bvn";
}

/** Stable one-way fingerprint of a BVN, for the unique bvnHash column. */
export function hashBvn(bvn: string): string {
  const clean = bvn.replace(/\D/g, "");
  return crypto.createHmac("sha256", secret()).update(clean).digest("hex");
}

/** Last 4 digits of a BVN, for display/support only. */
export function maskBvn(bvn: string): string {
  return bvn.replace(/\D/g, "").slice(-4);
}
