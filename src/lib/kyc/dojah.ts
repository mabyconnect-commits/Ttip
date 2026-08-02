import "server-only";
import { dojahConfig, type DojahConfig } from "./config";
import { nameMatches, type KycRequest, type KycResult } from "./types";

/**
 * Dojah identity-verification adapter (Nigeria: BVN & NIN).
 *
 * Flow: look up the government record by BVN/NIN, then require the name on the
 * record to match the name the user typed. A match verifies the account; a
 * mismatch fails it; anything else (document types we don't auto-check) goes to
 * manual review.
 *
 * Auth: Dojah uses two headers — `Authorization: <secret>` and `AppId: <appId>`.
 * Docs: https://docs.dojah.io/
 */

interface DojahEntity {
  first_name?: string;
  firstname?: string;
  last_name?: string;
  lastname?: string;
  surname?: string;
  middle_name?: string;
  middlename?: string;
  date_of_birth?: string;
  dateOfBirth?: string;
}

async function dojahGet(cfg: DojahConfig, path: string): Promise<{ ok: boolean; entity: DojahEntity | null; raw: unknown }> {
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    headers: { Authorization: cfg.secretKey, AppId: cfg.appId, Accept: "application/json" },
  });
  const raw = (await res.json().catch(() => null)) as { entity?: DojahEntity; data?: DojahEntity } | null;
  const entity = raw?.entity ?? raw?.data ?? null;
  return { ok: res.ok && !!entity, entity, raw };
}

function normalizeEntity(e: DojahEntity): { firstName?: string; lastName?: string; middleName?: string } {
  return {
    firstName: e.first_name ?? e.firstname,
    lastName: e.last_name ?? e.lastname ?? e.surname,
    middleName: e.middle_name ?? e.middlename,
  };
}

export async function dojahVerify(req: KycRequest): Promise<KycResult> {
  const cfg = dojahConfig();
  if (!cfg) throw new Error("Dojah is not configured (DOJAH_APP_ID / DOJAH_SECRET_KEY missing).");

  const digits = req.idNumber.replace(/\D/g, "");

  // Only BVN and NIN are auto-verified against the government record. Passport /
  // driver's-licence go to manual review rather than being rubber-stamped.
  if (req.idType === "bvn" || req.idType === "nin") {
    if (req.idType === "bvn" && digits.length !== 11) {
      return { status: "failed", tier: 1, provider: "dojah", reason: "A BVN is 11 digits.", matched: false };
    }
    if (req.idType === "nin" && digits.length !== 11) {
      return { status: "failed", tier: 1, provider: "dojah", reason: "A NIN is 11 digits.", matched: false };
    }

    const path =
      req.idType === "bvn"
        ? `/api/v1/kyc/bvn?bvn=${encodeURIComponent(digits)}`
        : `/api/v1/kyc/nin?nin=${encodeURIComponent(digits)}`;

    const { ok, entity, raw } = await dojahGet(cfg, path);
    if (!ok || !entity) {
      return { status: "failed", tier: 1, provider: "dojah", reason: `We couldn't find that ${req.idType.toUpperCase()}. Check the number and try again.`, matched: false };
    }

    const record = normalizeEntity(entity);
    // Sandbox returns fixed dummy identities whose names won't match a real
    // person's — so a successful lookup is enough to verify in sandbox. Live
    // keeps strict name-matching.
    const isSandbox = cfg.baseUrl.includes("sandbox");
    const matched = isSandbox ? true : nameMatches(req.fullName, record);
    if (!matched) {
      return {
        status: "failed",
        tier: 1,
        provider: "dojah",
        reason: "The name doesn't match this ID. Enter your name exactly as it appears on your BVN/NIN.",
        matched: false,
        ref: refFrom(raw),
      };
    }

    return { status: "verified", tier: 2, provider: "dojah", matched: true, ref: refFrom(raw) };
  }

  // Documents we don't auto-verify: accept for manual review, don't grant a tier.
  return {
    status: "pending",
    tier: 1,
    provider: "dojah",
    reason: "Your document was submitted for review. We'll email you within 24 hours.",
    matched: false,
  };
}

function refFrom(raw: unknown): string | undefined {
  const r = raw as { entity?: { reference?: string }; reference?: string } | null;
  return r?.reference ?? r?.entity?.reference ?? undefined;
}
