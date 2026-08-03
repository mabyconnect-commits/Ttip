import "server-only";
import { isLive } from "../settlement/config";

/**
 * KYC / identity-verification configuration.
 *
 * Providers:
 *   - "flutterwave" (default when live + configured): opening the BVN-linked
 *     dedicated account validates the BVN against NIBSS, so a successful account
 *     creation verifies the user AND provisions their naira account in one step.
 *   - "dojah": BVN/NIN checked against the government record with a name match —
 *     use for stricter, higher-tier verification (KYC_PROVIDER=dojah).
 *   - "sandbox": identity checks are simulated (demo deployments only).
 *
 * Override with KYC_PROVIDER=flutterwave|dojah|sandbox.
 */

export type KycMode = "sandbox" | "live";
export type KycProvider = "flutterwave" | "dojah" | "sandbox";

export function kycMode(): KycMode {
  return process.env.KYC_MODE === "live" ? "live" : "sandbox";
}

export function isKycLive(): boolean {
  return kycMode() === "live";
}

/**
 * Explicit opt-in for simulated (instant-approve) KYC on a test deployment.
 *
 * Hard-gated on NOT being live: sandboxVerify approves any well-formed 11-digit
 * number without checking it against any government record, so leaving DEMO_MODE
 * on in production would rubber-stamp invented IDs on real, withdrawable
 * accounts. Real money and simulated identity must never coexist.
 */
export function demoKycEnabled(): boolean {
  return process.env.DEMO_MODE === "true" && !isLive();
}

/**
 * Which provider verifies identity. Explicit KYC_PROVIDER wins. Otherwise:
 * Flutterwave when money is live and it's configured (verify + account in one),
 * else Dojah if KYC_MODE=live, else sandbox.
 */
export function kycProvider(): KycProvider {
  const explicit = process.env.KYC_PROVIDER?.toLowerCase();
  if (explicit === "flutterwave" || explicit === "dojah" || explicit === "sandbox") return explicit;
  if (isLive() && process.env.FLUTTERWAVE_SECRET_KEY) return "flutterwave";
  if (isKycLive()) return "dojah";
  return "sandbox";
}

/**
 * Whether identity can be verified at all. A real provider (Flutterwave/Dojah)
 * or demo. Anything else → disabled: the KYC endpoint refuses so fake IDs can
 * never verify a real account in production.
 */
export function kycEnabled(): boolean {
  const p = kycProvider();
  if (p === "flutterwave" || p === "dojah") return true;
  return demoKycEnabled();
}

/** "live" | "demo" | "disabled" — surfaced to the client. */
export function kycStatus(): "live" | "demo" | "disabled" {
  const p = kycProvider();
  if (p === "flutterwave" || p === "dojah") return "live";
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
