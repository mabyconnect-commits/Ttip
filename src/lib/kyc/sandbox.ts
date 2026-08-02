import type { KycRequest, KycResult } from "./types";

/**
 * Sandbox identity check — no provider call. A well-formed BVN/NIN (11 digits)
 * or any 6+ char document number instantly verifies, so the flow is fully
 * demoable. Live verification (Dojah) replaces this when KYC_MODE=live.
 */
export function sandboxVerify(req: KycRequest): KycResult {
  const digits = req.idNumber.replace(/\D/g, "");
  if ((req.idType === "bvn" || req.idType === "nin") && digits.length !== 11) {
    return { status: "failed", tier: 1, provider: "sandbox", reason: `A ${req.idType.toUpperCase()} is 11 digits.`, matched: false };
  }
  if (req.idNumber.trim().length < 6) {
    return { status: "failed", tier: 1, provider: "sandbox", reason: "Enter a valid ID number.", matched: false };
  }
  return { status: "verified", tier: 2, provider: "sandbox", matched: true, ref: "sbx_" + digits.slice(-4) };
}
