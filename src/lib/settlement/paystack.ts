import "server-only";
import type { PayoutRequest, PayoutResult } from "./types";
import { paystackConfig, type PaystackConfig } from "./config";
import { toSubunit } from "./webhook";

/**
 * Paystack payout provider (naira & other supported currencies) via the
 * Transfers API. Works with a test secret key (sk_test_…) or a live key.
 *
 * Flow: resolve bank code → create a transfer recipient → initiate the transfer.
 * Docs: https://paystack.com/docs/transfers/single-transfers
 */

function mapStatus(ps: string | undefined): PayoutResult["status"] {
  switch ((ps ?? "").toLowerCase()) {
    case "success":
      return "completed";
    case "failed":
    case "reversed":
      return "failed";
    default:
      return "pending"; // pending, otp, ...
  }
}

let bankCodeCache: { at: number; byName: Record<string, string> } | null = null;

async function resolveBankCode(cfg: PaystackConfig, currency: string, bankName?: string): Promise<string | undefined> {
  if (!bankName) return undefined;
  const country = currency === "NGN" ? "nigeria" : currency === "GHS" ? "ghana" : currency === "KES" ? "kenya" : currency === "ZAR" ? "south africa" : "nigeria";
  const fresh = bankCodeCache && Date.now() - bankCodeCache.at < 24 * 60 * 60 * 1000;
  if (!fresh) {
    const res = await fetch(`${cfg.baseUrl}/bank?country=${encodeURIComponent(country)}&currency=${currency}`, {
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

async function psPost(cfg: PaystackConfig, path: string, body: unknown): Promise<{ ok: boolean; json: any }> {
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.secretKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, json: await res.json() };
}

/** Resolve the account holder's name for a bank + account number (null if not found). */
export async function paystackResolveAccount(currency: string, bankName: string, accountNumber: string): Promise<string | null> {
  const cfg = paystackConfig();
  if (!cfg) return null;
  const bankCode = await resolveBankCode(cfg, currency, bankName);
  if (!bankCode) return null;
  const res = await fetch(`${cfg.baseUrl}/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`, {
    headers: { Authorization: `Bearer ${cfg.secretKey}` },
  });
  const json = (await res.json().catch(() => ({}))) as { status?: boolean; data?: { account_name?: string } };
  if (!res.ok || !json.status) return null;
  return json.data?.account_name ?? null;
}

export async function paystackPayout(req: PayoutRequest): Promise<PayoutResult> {
  const cfg = paystackConfig();
  if (!cfg) throw new Error("Paystack is not configured (PAYSTACK_SECRET_KEY missing).");

  const bankCode = req.bankCode ?? (await resolveBankCode(cfg, req.currency, req.bankName));
  if (!bankCode) {
    return { provider: "paystack", externalId: req.reference, status: "failed", message: `Could not resolve a bank code for "${req.bankName ?? ""}"` };
  }

  // 1. Create (or reuse) a transfer recipient.
  const recipient = await psPost(cfg, "/transferrecipient", {
    type: "nuban",
    name: req.accountName ?? "Ttip user",
    account_number: req.accountNumber,
    bank_code: bankCode,
    currency: req.currency,
  });
  const recipientCode = recipient.json?.data?.recipient_code;
  if (!recipient.ok || !recipientCode) {
    return { provider: "paystack", externalId: req.reference, status: "failed", message: recipient.json?.message ?? "Could not create transfer recipient", raw: recipient.json };
  }

  // 2. Initiate the transfer.
  const transfer = await psPost(cfg, "/transfer", {
    source: "balance",
    amount: toSubunit(req.amountFiat),
    recipient: recipientCode,
    reason: req.narration ?? "Ttip payout",
    currency: req.currency,
    reference: req.reference,
  });
  const data = transfer.json?.data;
  if (!transfer.ok || !data) {
    return { provider: "paystack", externalId: req.reference, status: "failed", message: transfer.json?.message ?? "Transfer failed", raw: transfer.json };
  }

  return {
    provider: "paystack",
    externalId: String(data.transfer_code ?? data.id ?? req.reference),
    status: mapStatus(data.status),
    message: transfer.json?.message,
    raw: transfer.json,
  };
}

/**
 * Re-query a transfer's status by our own reference.
 *
 * Same reason as the Flutterwave one: a transfer starts "pending" and only the
 * webhook ever moves it. If that webhook never lands, the receipt says
 * "Processing" for ever. Asking Paystack directly doesn't depend on anyone
 * calling us back.
 *
 * Docs: https://paystack.com/docs/api/transfer/#verify
 */
export async function paystackTransferStatus(reference: string): Promise<PayoutResult["status"] | null> {
  const cfg = paystackConfig();
  if (!cfg || !reference) return null;
  try {
    const res = await fetch(`${cfg.baseUrl}/transfer/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${cfg.secretKey}` },
    });
    const json = (await res.json().catch(() => ({}))) as { status?: boolean; data?: { status?: string } };
    if (!res.ok || !json.status || !json.data?.status) return null;
    return mapStatus(json.data.status);
  } catch (e) {
    console.error("[paystack] transfer status failed", e);
    return null;
  }
}
