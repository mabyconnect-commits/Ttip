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

export type PayoutProvider = "sandbox" | "flutterwave" | "paystack" | "monnify" | "coralpay";

const PAYOUT_PROVIDERS = ["paystack", "flutterwave", "monnify", "coralpay"] as const;

/**
 * Which provider actually moves the fiat. In sandbox mode it's always the
 * sandbox provider. In live mode, PAYOUT_PROVIDER decides; if unset we pick
 * whichever provider has keys. Pick cheapest-per-function: e.g. Monnify for
 * transfers, another for collection.
 */
export function payoutProvider(): PayoutProvider {
  if (!isLive()) return "sandbox";
  const explicit = process.env.PAYOUT_PROVIDER?.toLowerCase();
  if ((PAYOUT_PROVIDERS as readonly string[]).includes(explicit ?? "")) return explicit as PayoutProvider;
  if (process.env.MONNIFY_SECRET_KEY) return "monnify";
  if (process.env.PAYSTACK_SECRET_KEY) return "paystack";
  if (process.env.CORALPAY_SECRET_KEY) return "coralpay";
  return "flutterwave";
}

/** Which provider issues crypto deposit addresses + fires deposit webhooks. */
export function depositProvider(): string {
  return process.env.DEPOSIT_PROVIDER?.toLowerCase() || (process.env.DEXTOPUS_API_KEY ? "dextopus" : "sandbox");
}

export interface MonnifyConfig {
  apiKey: string;
  secretKey: string;
  contractCode: string;
  sourceAccountNumber: string;
  baseUrl: string;
}

export function monnifyConfig(): MonnifyConfig | null {
  const apiKey = process.env.MONNIFY_API_KEY;
  const secretKey = process.env.MONNIFY_SECRET_KEY;
  if (!apiKey || !secretKey) return null;
  return {
    apiKey,
    secretKey,
    contractCode: process.env.MONNIFY_CONTRACT_CODE || "",
    sourceAccountNumber: process.env.MONNIFY_SOURCE_ACCOUNT || "",
    baseUrl: process.env.MONNIFY_BASE_URL || "https://api.monnify.com",
  };
}

export interface CoralpayConfig {
  merchantId: string;
  secretKey: string;
  baseUrl: string;
}

export function coralpayConfig(): CoralpayConfig | null {
  const secretKey = process.env.CORALPAY_SECRET_KEY;
  if (!secretKey) return null;
  return {
    merchantId: process.env.CORALPAY_MERCHANT_ID || "",
    secretKey,
    baseUrl: process.env.CORALPAY_BASE_URL || "https://api.coralpay.com",
  };
}

export interface DextopusConfig {
  apiKey: string;
  webhookSecret: string | null;
  baseUrl: string;
  // Cross-chain settlement target — where deposits land (your treasury).
  settlementChainId: number | null;
  settlementAsset: string | null;
  settlementAddress: string | null;
  refundTo: string | null;
}

export function dextopusConfig(): DextopusConfig | null {
  const apiKey = process.env.DEXTOPUS_API_KEY;
  if (!apiKey) return null;
  const chain = Number(process.env.DEXTOPUS_SETTLEMENT_CHAIN_ID);
  return {
    apiKey,
    webhookSecret: process.env.DEXTOPUS_WEBHOOK_SECRET || null,
    baseUrl: process.env.DEXTOPUS_BASE_URL || "https://swap-api.dextopus.com",
    settlementChainId: Number.isFinite(chain) ? chain : null,
    settlementAsset: process.env.DEXTOPUS_SETTLEMENT_ASSET || null,
    settlementAddress: process.env.DEXTOPUS_SETTLEMENT_ADDRESS || null,
    refundTo: process.env.DEXTOPUS_REFUND_TO || null,
  };
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

export interface PaystackConfig {
  secretKey: string;
  baseUrl: string;
}

export function paystackConfig(): PaystackConfig | null {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) return null;
  return {
    secretKey,
    baseUrl: process.env.PAYSTACK_BASE_URL || "https://api.paystack.co",
  };
}
