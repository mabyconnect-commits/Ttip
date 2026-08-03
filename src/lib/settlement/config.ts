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

/**
 * Explicit opt-in for simulated money movement (sandbox credits/payouts without
 * a real provider). This exists so the app **fails closed**: if it's neither
 * live nor explicitly in demo, money-moving flows refuse rather than silently
 * faking success. Set DEMO_MODE=true only on a test deployment.
 */
export function demoEnabled(): boolean {
  return process.env.DEMO_MODE === "true";
}

/**
 * Whether money may move at all. Live (real providers) or demo (explicit
 * simulation). Anything else → disabled, and the money endpoints reject.
 */
export function settlementEnabled(): boolean {
  return isLive() || demoEnabled();
}

/** "live" | "demo" | "disabled" — surfaced to the client for the mode banner. */
export function settlementStatus(): "live" | "demo" | "disabled" {
  if (isLive()) return "live";
  if (demoEnabled()) return "demo";
  return "disabled";
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

export type BillProvider = "sandbox" | "flutterwave";

/**
 * Which provider pays bills (airtime, data, power, cable). Sandbox in demo; in
 * live it's Flutterwave, which exposes a Bill Payments API on the same account
 * and wallet used for payouts. BILL_PROVIDER can force it explicitly.
 */
export function billProvider(): BillProvider {
  if (!isLive()) return "sandbox";
  const explicit = process.env.BILL_PROVIDER?.toLowerCase();
  if (explicit === "flutterwave" || explicit === "sandbox") return explicit;
  return "flutterwave";
}

/**
 * Map an internal bill category to the `type` string Flutterwave expects on
 * `POST /v3/bills`. Flutterwave identifies billers by a type that must match its
 * biller list **for your account/country**, so these are overridable via the
 * BILL_TYPE_MAP env var (JSON, e.g. {"data":"MOBILEDATANG"}). Confirm the exact
 * strings for your account with GET /v3/bill-categories — the admin diagnostic
 * at /api/admin/flutterwave?bills=1 lists them.
 */
const DEFAULT_BILL_TYPES: Record<string, string> = {
  airtime: "AIRTIME",
  data: "DATA_BUNDLE",
  electricity: "ELECTRICITY_BILL",
  tv: "CABLE_BILL",
  internet: "INTERNET",
  betting: "BETTING",
};

export function billType(category: string): string | null {
  let override: Record<string, string> = {};
  try {
    override = JSON.parse(process.env.BILL_TYPE_MAP || "{}");
  } catch {
    override = {};
  }
  return override[category] ?? DEFAULT_BILL_TYPES[category] ?? null;
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
    baseUrl: process.env.DEXTOPUS_BASE_URL || "https://swap-api.dextopus.com/api",
    settlementChainId: Number.isFinite(chain) ? chain : null,
    settlementAsset: process.env.DEXTOPUS_SETTLEMENT_ASSET || null,
    settlementAddress: process.env.DEXTOPUS_SETTLEMENT_ADDRESS || null,
    refundTo: process.env.DEXTOPUS_REFUND_TO || null,
  };
}

/**
 * Whether Dextopus is allowed to send crypto OUT (withdrawals). On by default
 * once a Dextopus API key is present; set DEXTOPUS_WITHDRAW=false to disable and
 * keep non-Solana withdrawals queued for a manual signer instead.
 */
export function dextopusWithdrawEnabled(): boolean {
  return !!process.env.DEXTOPUS_API_KEY && (process.env.DEXTOPUS_WITHDRAW ?? "true").toLowerCase() !== "false";
}

/** The Dextopus endpoint path that initiates a withdrawal/payout (see their docs). */
export function dextopusWithdrawPath(): string {
  return process.env.DEXTOPUS_WITHDRAW_PATH || "/withdraw";
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

export interface SolanaConfig {
  rpcUrl: string;
  secretKey: string; // treasury keypair: base58 or JSON byte array
  usdcMint: string;
}

/**
 * Treasury Solana wallet for crypto withdrawals (USDC-SPL sends). Configured
 * only when SOLANA_TREASURY_SECRET_KEY is present; without it, crypto
 * withdrawals stay queued (never a false "sent"). Keep only a small hot float
 * here + a little SOL for fees; the rest belongs in cold storage.
 */
export function solanaConfig(): SolanaConfig | null {
  const secretKey = process.env.SOLANA_TREASURY_SECRET_KEY;
  if (!secretKey) return null;
  return {
    rpcUrl: process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
    secretKey,
    // Canonical mainnet USDC mint.
    usdcMint: process.env.SOLANA_USDC_MINT || "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  };
}

/** Per-withdrawal cap (in USDC) for the on-chain hot wallet. Default 2000. */
export function maxCryptoWithdrawal(): number {
  const v = Number(process.env.MAX_CRYPTO_WITHDRAWAL);
  return Number.isFinite(v) && v > 0 ? v : 2000;
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
