import "server-only";
import type { PayoutRequest, PayoutResult } from "./types";
import { coralpayConfig } from "./config";

/**
 * CoralPay payout provider (naira transfers).
 *
 * NOTE: CoralPay's disbursement API is partner-provisioned and its exact
 * endpoint/field names must be confirmed against the credentials CoralPay issues
 * you. This adapter follows their documented merchant-auth + transfer shape and
 * is safe to leave configured-off (it just isn't selected). Confirm the marked
 * fields before going live.
 */

function mapStatus(s: string | undefined): PayoutResult["status"] {
  switch ((s ?? "").toUpperCase()) {
    case "SUCCESSFUL":
    case "SUCCESS":
    case "00": // some CoralPay endpoints use ISO-8583-style response codes
      return "completed";
    case "FAILED":
    case "DECLINED":
      return "failed";
    default:
      return "pending";
  }
}

export async function coralpayPayout(req: PayoutRequest): Promise<PayoutResult> {
  const cfg = coralpayConfig();
  if (!cfg) throw new Error("CoralPay is not configured (CORALPAY_SECRET_KEY missing).");

  // Confirm this endpoint + payload against your CoralPay integration pack.
  const res = await fetch(`${cfg.baseUrl}/transactions/transfer`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      merchantId: cfg.merchantId,
      amount: req.amountFiat,
      currency: req.currency,
      reference: req.reference,
      narration: req.narration ?? "Ttip payout",
      bankCode: req.bankCode,
      accountNumber: req.accountNumber,
      accountName: req.accountName,
    }),
  });

  const json = (await res.json().catch(() => ({}))) as { status?: string; responseCode?: string; message?: string; data?: { reference?: string; transactionId?: string } };
  const code = json.status ?? json.responseCode;
  if (!res.ok || mapStatus(code) === "failed") {
    return { provider: "coralpay", externalId: req.reference, status: "failed", message: json.message ?? `Transfer failed (${res.status})`, raw: json };
  }

  return {
    provider: "coralpay",
    externalId: json.data?.transactionId ?? json.data?.reference ?? req.reference,
    status: mapStatus(code),
    message: json.message,
    raw: json,
  };
}
