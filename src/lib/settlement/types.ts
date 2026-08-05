/**
 * A crypto deposit, normalized across providers, ready to credit the ledger.
 *
 * A deposit has TWO sides and they must never be mixed:
 *
 *   origin      — what the user actually sent (0.4 SOL on Solana)
 *   settlement  — what actually landed in treasury after the cross-chain
 *                 conversion (e.g. 62.14 USDC)
 *
 * `asset`/`amount` are ALWAYS the settlement pair: that is the real value the
 * platform received and therefore the only thing safe to credit. The origin
 * pair is carried alongside purely so the user can be shown what they sent.
 *
 * Pairing an asset symbol from one side with an amount from the other is how
 * 0.4 SOL once got credited as 0.4 USDC. Keep them together.
 */
export interface NormalizedDeposit {
  /** Provider id or on-chain tx hash — the idempotency key. Required. */
  externalId: string;
  /** The deposit address that received the funds (used to resolve the user). */
  address: string;
  /** SETTLEMENT asset symbol — what treasury received, e.g. USDC. */
  asset: string;
  /** Chain/network id, e.g. tron, bsc, ethereum, solana. */
  chain: string;
  /** SETTLEMENT amount, denominated in `asset`. This is what gets credited. */
  amount: number;
  /** "confirmed" credits immediately; "pending" is recorded but not credited. */
  status: "confirmed" | "pending";
  /** Which provider produced this event. */
  provider: string;
  /** ORIGIN asset symbol — what the user actually sent, e.g. SOL. Display only. */
  originAsset?: string;
  /** ORIGIN amount, denominated in `originAsset`. Display only — never credited. */
  originAmount?: number;
  /** The chain the user sent from, when it differs from the settlement chain. */
  originChain?: string;
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
