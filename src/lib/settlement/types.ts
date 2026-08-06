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
  /**
   * True when `asset`/`amount` are the SETTLEMENT pair (what landed in treasury,
   * e.g. USDC), false when they're the ORIGIN pair (what the user sent, e.g.
   * SOL). Lets the webhook relabel a settlement mint to our symbol WITHOUT ever
   * pairing the settlement asset with the origin amount — the mis-credit that
   * turned 1.3 SOL into "1.3 USDC".
   */
  settled?: boolean;
  /** Provider-supplied user id (e.g. Dextopus echoes the userId we set). */
  userId?: string;
  /** On-chain tx hash, for a block-explorer trace link. */
  txHash?: string;
  /** Numeric chain id, for building the explorer URL. */
  chainId?: number;
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

/** A request to pay a bill (airtime, data, electricity, cable, …) to a biller. */
export interface BillRequest {
  userId: string;
  /** Our category id — airtime | data | electricity | tv | internet. */
  category: string;
  /** Human biller/provider name, e.g. MTN, DStv, EKEDC. */
  provider: string;
  /** Flutterwave biller code for the chosen plan, e.g. BIL099. */
  billerCode: string;
  /** Flutterwave item code for the chosen plan, e.g. AT099 (airtime) / CB177 (DStv Compact). */
  itemCode: string;
  /** The thing being topped up: phone number, meter no., smartcard no., customer id. */
  customer: string;
  /** Bill face value in `currency`. */
  amountFiat: number;
  currency: string; // NGN, …
  /** Our idempotency reference. */
  reference: string;
}

export interface BillResult {
  provider: string; // "flutterwave" | "sandbox"
  /** Provider bill id / our reference. */
  externalId: string;
  status: "pending" | "completed" | "failed";
  message?: string;
  raw?: unknown;
}

/** Validation of a bill customer (e.g. resolve the name on a meter / smartcard). */
export interface BillValidation {
  valid: boolean;
  /** Customer/account name when the biller returns one. */
  name?: string;
  message?: string;
}
