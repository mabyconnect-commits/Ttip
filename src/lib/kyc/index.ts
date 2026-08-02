import "server-only";
import { kycProvider } from "./config";
import { dojahVerify } from "./dojah";
import { flutterwaveVerify } from "./flutterwave";
import { sandboxVerify } from "./sandbox";
import type { KycRequest, KycResult } from "./types";

export type { KycRequest, KycResult, IdType, KycStatus } from "./types";
export { kycMode, isKycLive, kycEnabled, kycStatus, kycProvider } from "./config";

/**
 * Verify a user's identity through the active provider:
 *   - flutterwave: BVN validated by opening the dedicated account (verify +
 *     provision in one step).
 *   - dojah: BVN/NIN checked against the government record with a name match.
 *   - sandbox: instant approve (demo only).
 */
export async function verifyIdentity(req: KycRequest): Promise<KycResult> {
  switch (kycProvider()) {
    case "flutterwave":
      return flutterwaveVerify(req);
    case "dojah":
      return dojahVerify(req);
    default:
      return sandboxVerify(req);
  }
}
