import "server-only";

/**
 * Settlement configuration, read from the environment.
 *
 * The app runs in one of two modes:
 *   - "sandbox" (default): no external money moves. Deposits are credited by a
 *     signed webhook or the in-app simulator; payouts are recorded as completed
 *     without calling a bank. Everything else — the ledger, balances, receipts —
 *     is identical to live, so the full loop is demoable end-to-end.
 *   - "live": crypto deposits are swept into treasury by the deposit provider,
 *     which calls our webhook; naira payouts go out through Flutterwave.
 *
 * Flip to live by setting SETTLEMENT_MODE=live and supplying the provider keys.
 */

export type SettlementMode = "sandbox" | "live";

export function settlementMode(): SettlementMode {
  return process.env.SETTLEMENT_MODE === "live" ? "live" : "sandbox";
}

export function isLive(): boolean {
  return settlementMode() === "live";
}

/** Shared secret used to authenticate inbound crypto-deposit webhooks (HMAC-SHA256). */
export function depositWebhookSecret(): string | null {
  return process.env.DEPOSIT_WEBHOOK_SECRET || null;
}

export interface FlutterwaveConfig {
  secretKey: string;
  webhookHash: string | null;
  baseUrl: string;
}

export function flutterwaveConfig(): FlutterwaveConfig | null {
  const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!secretKey) return null;
  return {
    secretKey,
    webhookHash: process.env.FLUTTERWAVE_WEBHOOK_HASH || null,
    baseUrl: process.env.FLUTTERWAVE_BASE_URL || "https://api.flutterwave.com/v3",
  };
}
