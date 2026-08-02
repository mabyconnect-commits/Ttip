import "server-only";

/**
 * KYC / identity-verification configuration.
 *
 * Two modes, mirroring the settlement layer:
 *   - "sandbox" (default): identity checks are simulated — a well-formed ID
 *     instantly verifies. Lets the whole flow be demoed without a provider.
 *   - "live": BVN/NIN are checked against the government record via Dojah, and
 *     the supplied name must match before the account is verified.
 *
 * Flip with KYC_MODE=live and supply DOJAH_APP_ID + DOJAH_SECRET_KEY.
 */

export type KycMode = "sandbox" | "live";

export function kycMode(): KycMode {
  return process.env.KYC_MODE === "live" ? "live" : "sandbox";
}

export function isKycLive(): boolean {
  return kycMode() === "live";
}

export interface DojahConfig {
  appId: string;
  secretKey: string;
  baseUrl: string;
}

export function dojahConfig(): DojahConfig | null {
  const appId = process.env.DOJAH_APP_ID;
  const secretKey = process.env.DOJAH_SECRET_KEY;
  if (!appId || !secretKey) return null;
  return {
    appId,
    secretKey,
    // Sandbox: https://sandbox.dojah.io — Production: https://api.dojah.io
    baseUrl: process.env.DOJAH_BASE_URL || "https://api.dojah.io",
  };
}
