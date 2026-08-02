import "server-only";
import type { PayoutRequest, PayoutResult } from "./types";
import { flutterwaveConfig, type FlutterwaveConfig } from "./config";

/**
 * Flutterwave payout provider (naira-out and other African currencies) via the
 * Transfers API. Works in test mode with a test secret key (FLWSECK_TEST-…) and
 * in live mode with a live key — the code path is identical.
 *
 * Docs: https://developer.flutterwave.com/reference/create-a-transfer
 */

interface FwTransferResponse {
  status: string; // "success" | "error"
  message?: string;
  data?: { id: number; status: string; reference?: string };
}

function mapStatus(fw: string | undefined): PayoutResult["status"] {
  switch ((fw ?? "").toUpperCase()) {
    case "SUCCESSFUL":
      return "completed";
    case "FAILED":
      return "failed";
    default:
      return "pending"; // NEW, PENDING, ...
  }
}

// Flutterwave wants a numeric bank code, not a name. Resolve + cache per process.
let bankCodeCache: { at: number; byName: Record<string, string> } | null = null;

async function resolveBankCode(cfg: FlutterwaveConfig, currency: string, bankName?: string): Promise<string | undefined> {
  if (!bankName) return undefined;
  const country = currency === "NGN" ? "NG" : currency === "GHS" ? "GH" : currency === "KES" ? "KE" : currency === "ZAR" ? "ZA" : "NG";
  const fresh = bankCodeCache && Date.now() - bankCodeCache.at < 24 * 60 * 60 * 1000;
  if (!fresh) {
    const res = await fetch(`${cfg.baseUrl}/banks/${country}`, {
      headers: { Authorization: `Bearer ${cfg.secretKey}` },
    });
    const json = (await res.json()) as { data?: { code: string; name: string }[] };
    const byName: Record<string, string> = {};
    for (const b of json.data ?? []) byName[b.name.toLowerCase()] = b.code;
    bankCodeCache = { at: Date.now(), byName };
  }
  const key = bankName.toLowerCase();
  const map = bankCodeCache!.byName;
  return map[key] ?? Object.entries(map).find(([n]) => n.includes(key) || key.includes(n))?.[1];
}

export async function flutterwavePayout(req: PayoutRequest): Promise<PayoutResult> {
  const cfg = flutterwaveConfig();
  if (!cfg) throw new Error("Flutterwave is not configured (FLUTTERWAVE_SECRET_KEY missing).");

  const account_bank = req.bankCode ?? (await resolveBankCode(cfg, req.currency, req.bankName));
  if (!account_bank) {
    return { provider: "flutterwave", externalId: req.reference, status: "failed", message: `Could not resolve a bank code for "${req.bankName ?? ""}"` };
  }

  const res = await fetch(`${cfg.baseUrl}/transfers`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      account_bank,
      account_number: req.accountNumber,
      amount: req.amountFiat,
      currency: req.currency,
      narration: req.narration ?? "Ttip payout",
      reference: req.reference,
      debit_currency: req.currency,
    }),
  });

  const json = (await res.json()) as FwTransferResponse;
  if (!res.ok || json.status !== "success" || !json.data) {
    return { provider: "flutterwave", externalId: req.reference, status: "failed", message: json.message ?? `Transfer failed (${res.status})`, raw: json };
  }

  return {
    provider: "flutterwave",
    externalId: String(json.data.id),
    status: mapStatus(json.data.status),
    message: json.message,
    raw: json,
  };
}

/**
 * Resolve the account holder's name for a bank + account number, so the user can
 * confirm the recipient before sending. Returns null if it can't be resolved.
 * Docs: https://developer.flutterwave.com/reference/verify-bank-account
 */
export async function flutterwaveResolveAccount(currency: string, bankName: string, accountNumber: string): Promise<string | null> {
  const cfg = flutterwaveConfig();
  if (!cfg) return null;
  const account_bank = await resolveBankCode(cfg, currency, bankName);
  if (!account_bank) return null;
  const res = await fetch(`${cfg.baseUrl}/accounts/resolve`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.secretKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ account_number: accountNumber, account_bank }),
  });
  const json = (await res.json().catch(() => ({}))) as { status?: string; data?: { account_name?: string } };
  if (!res.ok || json.status !== "success") return null;
  return json.data?.account_name ?? null;
}

/** Verify a Flutterwave webhook using the shared verif-hash header. */
export function verifyFlutterwaveWebhook(signature: string | null): boolean {
  const cfg = flutterwaveConfig();
  if (!cfg?.webhookHash) return false;
  return !!signature && signature === cfg.webhookHash;
}
