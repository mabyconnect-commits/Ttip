import "server-only";
import { bybitConfig, bybitDepositAddress, bybitBalance, bybitEnabled } from "./bybit";

/**
 * Where treasury crypto becomes naira.
 *
 * This exists because the first choice failed for a reason no code could fix:
 * Bybit answers a Nigerian IP with "Service Restricted — not available to you
 * due to regulatory restrictions". A venue that will not take the operator as a
 * customer is not a venue, however good the integration is.
 *
 * So the venue is now an interface with a registry behind it, picked by
 * LIQUIDITY_VENUE. Adding one is writing a single file and one line here —
 * nothing in float.ts, the admin desk, or the payout path changes. The next
 * time a provider withdraws from a market, or a better one appears, that is a
 * contained afternoon rather than a rewrite.
 *
 * What a venue must do:
 *   depositAddress()  — where to send treasury USDC. Required.
 *   balance()         — has it landed yet. Required, so nobody checks by hand.
 *   sell()            — turn it into naira and settle to the payout account.
 *                       OPTIONAL, and the honest part: an exchange that only
 *                       offers merchant P2P cannot do this, and the payout-hold
 *                       window exists precisely to cover the human step. A venue
 *                       that CAN do it closes the loop end to end.
 */

export interface VenueSell {
  ok: boolean;
  /** Fiat actually raised, when the venue can tell us. */
  raisedFiat?: number;
  message: string;
}

export interface SettlementVenue {
  name: string;
  /** What the treasury sends, and on which chain. */
  coin: string;
  chain: string;
  depositAddress(): Promise<{ address: string; chain: string } | null>;
  balance(): Promise<number | null>;
  /** Absent when the venue can't be automated — the operator finishes the sell. */
  sell?(amount: number, fiat: string): Promise<VenueSell>;
}

const bybitVenue = (): SettlementVenue | null => {
  const cfg = bybitConfig();
  if (!cfg || !bybitEnabled()) return null;
  return {
    name: "bybit",
    coin: cfg.coin,
    chain: cfg.chain,
    depositAddress: bybitDepositAddress,
    balance: bybitBalance,
    // No sell(): Bybit's P2P API is merchant-only under a separate agreement,
    // so the trade is a person. Saying that in the shape of the object is
    // better than a function that always fails.
  };
};

/**
 * The venue in use, or null when none is configured.
 *
 * Null is a first-class answer: raiseFloat still records the shortfall, still
 * holds the payout, and still tells the operator what needs raising by hand.
 * A missing venue must never look like a working one.
 */
export function settlementVenue(): SettlementVenue | null {
  const want = (process.env.LIQUIDITY_VENUE ?? "").trim().toLowerCase();
  const registry: Record<string, () => SettlementVenue | null> = {
    bybit: bybitVenue,
  };

  if (want) return registry[want]?.() ?? null;
  // No explicit choice: use whichever one is actually configured.
  for (const make of Object.values(registry)) {
    const v = make();
    if (v) return v;
  }
  return null;
}

export function venueEnabled(): boolean {
  return settlementVenue() !== null;
}
