import crypto from "crypto";
import type { PayoutRequest, PayoutResult, BillRequest, BillResult } from "./types";

/**
 * Sandbox provider — no external calls. A payout is recorded as completed with a
 * synthetic reference so the whole crypto-in → naira-out loop is demoable end to
 * end without a funded float or a live bank integration.
 */
export function sandboxPayout(req: PayoutRequest): PayoutResult {
  return {
    provider: "sandbox",
    externalId: "sbx_" + crypto.randomUUID(),
    status: "completed",
    message: `Sandbox payout of ${req.amountFiat} ${req.currency} to ••${req.accountNumber.slice(-4)}`,
  };
}

/** Sandbox bill payment — settles instantly so the flow is demoable end to end. */
export function sandboxBillPay(req: BillRequest): BillResult {
  return {
    provider: "sandbox",
    externalId: "sbxbill_" + crypto.randomUUID(),
    status: "completed",
    message: `Sandbox ${req.category} of ${req.amountFiat} ${req.currency} to ${req.provider} · ${req.customer}`,
  };
}
