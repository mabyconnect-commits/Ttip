import "server-only";
import type { PayoutRequest, PayoutResult, BillRequest, BillResult, BillValidation } from "./types";
import { flutterwaveConfig, billType, type FlutterwaveConfig } from "./config";
import { mapBillStatus } from "./bill-status";

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

/**
 * Optional static-IP egress for Flutterwave.
 *
 * Flutterwave's live Transfers API requires **IP Whitelisting**, but Vercel's
 * serverless functions egress from dynamic, shared IPs that can't be whitelisted.
 * Set `FLUTTERWAVE_PROXY_URL` to a fixed-IP forward proxy (e.g. Fixie/QuotaGuard
 * Static) and whitelist that single IP on Flutterwave — every Flutterwave call
 * then leaves from the same address. With no proxy configured, behaviour is
 * unchanged (direct fetch).
 */
let dispatcherPromise: Promise<unknown> | undefined;
async function fwDispatcher(): Promise<unknown> {
  const url = process.env.FLUTTERWAVE_PROXY_URL;
  if (!url) return undefined;
  if (!dispatcherPromise) {
    const mod = "undici"; // non-literal specifier: loaded only when a proxy is set
    dispatcherPromise = import(mod)
      .then((u: any) => new u.ProxyAgent(url))
      .catch(() => null);
  }
  return (await dispatcherPromise) ?? undefined;
}

/** fetch that routes through the static-IP proxy when one is configured. */
export async function fwFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const dispatcher = await fwDispatcher();
  return fetch(url, (dispatcher ? { ...init, dispatcher } : init) as RequestInit);
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
    const res = await fwFetch(`${cfg.baseUrl}/banks/${country}`, {
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

  const res = await fwFetch(`${cfg.baseUrl}/transfers`, {
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
 * Pay a bill (airtime, data, electricity, cable, …) via Flutterwave's Bill
 * Payments API. Debits the same Flutterwave wallet that funds payouts.
 * Docs: https://developer.flutterwave.com/reference/create-a-bill-payment
 */
export async function flutterwaveBillPay(req: BillRequest): Promise<BillResult> {
  const cfg = flutterwaveConfig();
  if (!cfg) throw new Error("Flutterwave is not configured (FLUTTERWAVE_SECRET_KEY missing).");

  const type = billType(req.category);
  if (!type) {
    return { provider: "flutterwave", externalId: req.reference, status: "failed", message: `No Flutterwave bill type mapped for "${req.category}"` };
  }
  const country = req.currency === "GHS" ? "GH" : req.currency === "KES" ? "KE" : req.currency === "ZAR" ? "ZA" : "NG";

  let res: Response;
  try {
    res = await fwFetch(`${cfg.baseUrl}/bills`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.secretKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        country,
        customer: req.customer,
        amount: req.amountFiat,
        recurrence: "ONCE",
        type,
        reference: req.reference,
        biller_name: req.provider,
      }),
    });
  } catch (e) {
    return { provider: "flutterwave", externalId: req.reference, status: "failed", message: `Couldn't reach Flutterwave: ${String(e)}` };
  }

  const json = (await res.json().catch(() => ({}))) as { status?: string; message?: string; data?: any };
  if (!res.ok || json.status !== "success") {
    return { provider: "flutterwave", externalId: req.reference, status: "failed", message: json.message ?? `Bill payment failed (${res.status})`, raw: json };
  }

  // The create call accepted it; the delivery state may be terminal already
  // (airtime is usually instant) or still processing. Re-query once so a fast
  // biller completes now instead of leaving the user on "processing".
  let status = mapBillStatus(json);
  if (status === "pending") {
    const requeried = await flutterwaveBillStatus(req.reference).catch(() => null);
    if (requeried && requeried !== "pending") status = requeried;
  }

  return { provider: "flutterwave", externalId: String(json.data?.flw_ref ?? json.data?.tx_ref ?? req.reference), status, message: json.message, raw: json };
}

/**
 * Re-query a bill's delivery status by our reference. Used to settle a bill that
 * came back "processing", and by the reconcile path.
 * Docs: https://developer.flutterwave.com/reference/get-a-bill-payment-status
 */
export async function flutterwaveBillStatus(reference: string): Promise<PayoutResult["status"] | null> {
  const cfg = flutterwaveConfig();
  if (!cfg) return null;
  const res = await fwFetch(`${cfg.baseUrl}/bills/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${cfg.secretKey}` },
  });
  const json = (await res.json().catch(() => ({}))) as { status?: string; data?: any };
  if (!res.ok || json.status !== "success") return null;
  return mapBillStatus(json);
}

/**
 * Validate a bill customer (e.g. resolve the name on an electricity meter or a
 * cable smartcard) so the user can confirm before paying. Best-effort: returns
 * { valid:false } when the biller can't be validated (e.g. airtime).
 * Docs: https://developer.flutterwave.com/reference/validate-a-customer
 */
export async function flutterwaveValidateBill(category: string, customer: string): Promise<BillValidation> {
  const cfg = flutterwaveConfig();
  if (!cfg) return { valid: false };
  const type = billType(category);
  if (!type) return { valid: false };
  try {
    const res = await fwFetch(`${cfg.baseUrl}/bill-items/${encodeURIComponent(type)}/validate?code=${encodeURIComponent(type)}&customer=${encodeURIComponent(customer)}`, {
      headers: { Authorization: `Bearer ${cfg.secretKey}` },
    });
    const json = (await res.json().catch(() => ({}))) as { status?: string; message?: string; data?: { name?: string; customer?: string } };
    if (!res.ok || json.status !== "success") return { valid: false, message: json.message };
    const name = json.data?.name;
    return { valid: !!name, name: name || undefined };
  } catch {
    return { valid: false };
  }
}

/**
 * List Flutterwave bill categories for the current account — used by the admin
 * diagnostic so the operator can read the exact `type`/biller codes to configure
 * in BILL_TYPE_MAP. Docs: https://developer.flutterwave.com/reference/get-bill-categories
 */
export async function flutterwaveBillCategories(): Promise<unknown> {
  const cfg = flutterwaveConfig();
  if (!cfg) return null;
  const res = await fwFetch(`${cfg.baseUrl}/bill-categories?country=NG`, {
    headers: { Authorization: `Bearer ${cfg.secretKey}` },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
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
  const res = await fwFetch(`${cfg.baseUrl}/accounts/resolve`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.secretKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ account_number: accountNumber, account_bank }),
  });
  const json = (await res.json().catch(() => ({}))) as { status?: string; data?: { account_name?: string } };
  if (!res.ok || json.status !== "success") return null;
  return json.data?.account_name ?? null;
}

/**
 * Create a permanent dedicated virtual account (DVA) for a user, so they can
 * fund their naira balance by bank transfer. Permanent accounts require a BVN.
 * Returns the account number + bank, or null on failure.
 * Docs: https://developer.flutterwave.com/reference/create-a-virtual-account-number
 */
export async function flutterwaveCreateVirtualAccount(
  email: string,
  bvn: string,
  name: string,
  reference: string,
): Promise<{ accountNumber: string; bankName: string } | { error: string }> {
  const cfg = flutterwaveConfig();
  if (!cfg) return { error: "Flutterwave is not configured (FLUTTERWAVE_SECRET_KEY missing)." };
  let res: Response;
  try {
    res = await fwFetch(`${cfg.baseUrl}/virtual-account-numbers`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.secretKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        bvn,
        is_permanent: true,
        tx_ref: reference,
        narration: name,
      }),
    });
  } catch (e) {
    return { error: `Couldn't reach Flutterwave: ${String(e)}` };
  }
  // Capture the raw body first — a 502/HTML gateway error has no JSON message,
  // and we want Flutterwave's exact words surfaced, not a bare status code.
  const bodyText = await res.text().catch(() => "");
  let json: { status?: string; message?: string; data?: { account_number?: string; bank_name?: string } } = {};
  try {
    json = JSON.parse(bodyText);
  } catch {
    /* non-JSON (e.g. an HTML 5xx gateway page) — fall back to the raw text */
  }
  if (!res.ok || json.status !== "success" || !json.data?.account_number) {
    const snippet = bodyText.replace(/\s+/g, " ").trim().slice(0, 160);
    const detail = json.message || snippet || `no response body`;
    return { error: `Flutterwave (HTTP ${res.status}): ${detail}` };
  }
  return { accountNumber: json.data.account_number, bankName: json.data.bank_name || "Wema Bank" };
}

/** Verify a Flutterwave webhook using the shared verif-hash header. */
export function verifyFlutterwaveWebhook(signature: string | null): boolean {
  const cfg = flutterwaveConfig();
  if (!cfg?.webhookHash) return false;
  return !!signature && signature === cfg.webhookHash;
}
