/** A crypto deposit, normalized across providers, ready to credit the ledger. */
export interface NormalizedDeposit {
  /** Provider id or on-chain tx hash — the idempotency key. Required. */
  externalId: string;
  /** The deposit address that received the funds (used to resolve the user). */
  address: string;
  /** Asset symbol, e.g. USDT, USDC, BTC. */
  asset: string;
  /** Chain/network id, e.g. tron, bsc, ethereum, solana. */
  chain: string;
  /** Amount of `asset` received. */
  amount: number;
  /** "confirmed" credits immediately; "pending" is recorded but not credited. */
  status: "confirmed" | "pending";
  /** Which provider produced this event. */
  provider: string;
  /** Raw payload, kept for audit. */
  raw?: unknown;
}

/** A request to pay fiat out to a bank account. */
export interface PayoutRequest {
  userId: string;
  /** Amount in `currency` (e.g. naira). */
  amountFiat: number;
  currency: string; // NGN, GHS, KES, ZAR
  accountNumber: string;
  /** Provider bank code (Flutterwave). Resolved from bankName in live mode if absent. */
  bankCode?: string;
  bankName?: string;
  accountName?: string;
  narration?: string;
  /** Our idempotency reference. */
  reference: string;
}

export interface PayoutResult {
  provider: string;
  /** Provider transfer id. */
  externalId: string;
  status: "pending" | "completed" | "failed";
  message?: string;
  raw?: unknown;
}
