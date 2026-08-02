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

/** Explicit opt-in for simulated (instant-approve) KYC on a test deployment. */
export function demoKycEnabled(): boolean {
  return process.env.DEMO_MODE === "true";
}

/**
 * Whether identity can be verified at all. Live (Dojah) or demo (simulated).
 * Anything else → disabled: the KYC endpoint refuses so fake IDs can never
 * verify a real account in production.
 */
export function kycEnabled(): boolean {
  return isKycLive() || demoKycEnabled();
}

/** "live" | "demo" | "disabled" — surfaced to the client. */
export function kycStatus(): "live" | "demo" | "disabled" {
  if (isKycLive()) return "live";
  if (demoKycEnabled()) return "demo";
  return "disabled";
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
