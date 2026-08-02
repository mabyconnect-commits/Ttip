import "server-only";
import { isKycLive } from "./config";
import { dojahVerify } from "./dojah";
import { sandboxVerify } from "./sandbox";
import type { KycRequest, KycResult } from "./types";

export type { KycRequest, KycResult, IdType, KycStatus } from "./types";
export { kycMode, isKycLive, kycEnabled, kycStatus } from "./config";

/**
 * Verify a user's identity through the active provider. Sandbox settles
 * instantly; live routes BVN/NIN to Dojah and matches the name on the record.
 */
export async function verifyIdentity(req: KycRequest): Promise<KycResult> {
  if (isKycLive()) return dojahVerify(req);
  return sandboxVerify(req);
}
