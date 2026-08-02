import "server-only";
import type { PayoutRequest, PayoutResult } from "./types";
import { monnifyConfig, type MonnifyConfig } from "./config";

/**
 * Monnify payout provider (naira transfers) via the Disbursement API. Monnify
 * has the cheapest published payout tiers (₦10/₦20/₦40). Works with test or live
 * keys — same code path.
 *
 * Docs: https://developers.monnify.com/docs/disbursements
 */

function mapStatus(s: string | undefined): PayoutResult["status"] {
  switch ((s ?? "").toUpperCase()) {
    case "SUCCESS":
      return "completed";
    case "FAILED":
    case "REVERSED":
      return "failed";
    default:
      return "pending"; // PENDING, IN_PROGRESS, ...
  }
}

async function authToken(cfg: MonnifyConfig): Promise<string | null> {
  const basic = Buffer.from(`${cfg.apiKey}:${cfg.secretKey}`).toString("base64");
  const res = await fetch(`${cfg.baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}` },
  });
  const json = (await res.json()) as { responseBody?: { accessToken?: string } };
  return json.responseBody?.accessToken ?? null;
}

let bankCodeCache: { at: number; byName: Record<string, string> } | null = null;

async function resolveBankCode(cfg: MonnifyConfig, token: string, bankName?: string): Promise<string | undefined> {
  if (!bankName) return undefined;
  const fresh = bankCodeCache && Date.now() - bankCodeCache.at < 24 * 60 * 60 * 1000;
  if (!fresh) {
    const res = await fetch(`${cfg.baseUrl}/api/v1/banks`, { headers: { Authorization: `Bearer ${token}` } });
    const json = (await res.json()) as { responseBody?: { code: string; name: string }[] };
    const byName: Record<string, string> = {};
    for (const b of json.responseBody ?? []) byName[b.name.toLowerCase()] = b.code;
    bankCodeCache = { at: Date.now(), byName };
  }
  const key = bankName.toLowerCase();
  const map = bankCodeCache!.byName;
  return map[key] ?? Object.entries(map).find(([n]) => n.includes(key) || key.includes(n))?.[1];
}

export async function monnifyPayout(req: PayoutRequest): Promise<PayoutResult> {
  const cfg = monnifyConfig();
  if (!cfg) throw new Error("Monnify is not configured (MONNIFY_API_KEY / MONNIFY_SECRET_KEY missing).");

  const token = await authToken(cfg);
  if (!token) return { provider: "monnify", externalId: req.reference, status: "failed", message: "Monnify auth failed" };

  const bankCode = req.bankCode ?? (await resolveBankCode(cfg, token, req.bankName));
  if (!bankCode) {
    return { provider: "monnify", externalId: req.reference, status: "failed", message: `Could not resolve a bank code for "${req.bankName ?? ""}"` };
  }

  const res = await fetch(`${cfg.baseUrl}/api/v2/disbursements/single`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: req.amountFiat,
      reference: req.reference,
      narration: req.narration ?? "Ttip payout",
      destinationBankCode: bankCode,
      destinationAccountNumber: req.accountNumber,
      currency: req.currency,
      sourceAccountNumber: cfg.sourceAccountNumber,
    }),
  });
  const json = (await res.json()) as { requestSuccessful?: boolean; responseMessage?: string; responseBody?: { status?: string; reference?: string } };
  if (!res.ok || !json.requestSuccessful || !json.responseBody) {
    return { provider: "monnify", externalId: req.reference, status: "failed", message: json.responseMessage ?? `Disbursement failed (${res.status})`, raw: json };
  }

  return {
    provider: "monnify",
    externalId: json.responseBody.reference ?? req.reference,
    status: mapStatus(json.responseBody.status),
    message: json.responseMessage,
    raw: json,
  };
}
