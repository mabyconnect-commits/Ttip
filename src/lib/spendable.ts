import "server-only";
import { isCrypto } from "./prices";
import { referenceFiat } from "./rate";
import { quoteSell } from "./pricing";

/**
 * What a wallet is worth to spend, and what all of them are worth together.
 *
 * A payout is funded from EVERYTHING the user holds — naira first, then crypto,
 * sold at the moment of sending (see lib/funding-plan.ts). So "do you have
 * enough?" is never a question about one wallet, and answering it from a single
 * balance is how Ada came to tell someone holding USDT to go and swap it to
 * naira first. They don't have to. The app does that as part of the send.
 *
 * The rate used is the SELL rate, the one the user actually receives, so the
 * figure quoted here is the figure they can actually spend rather than a market
 * value they'd never see.
 */

/**
 * The fiat a holding converts to for the user.
 *
 * Shared with /api/send rather than reimplemented: two answers to "what is this
 * worth" is how an assistant ends up contradicting the checkout.
 */
export async function sellValue(amount: number, symbol: string, fiat: string): Promise<number> {
  if (!(amount > 0)) return 0;
  if (symbol === fiat || !isCrypto(symbol)) {
    return symbol === fiat ? amount : await referenceFiat(amount, symbol, fiat);
  }
  const market = await referenceFiat(amount, symbol, fiat);
  const marketRate = market / amount;
  return quoteSell({ asset: symbol, fiat, amountAsset: amount, marketRate }).userFiat;
}

export interface SpendableWallet {
  symbol: string;
  amount: number;
  /** What this wallet alone would raise, in the payout currency. */
  fiat: number;
}

export interface Spendable {
  fiat: string;
  total: number;
  wallets: SpendableWallet[];
}

/**
 * Every wallet valued in one currency, plus the total.
 *
 * Best-effort: a wallet whose price we can't fetch is left out of the total
 * rather than counted as zero-and-mentioned, because an assistant that
 * understates a balance tells people they can't afford things they can.
 */
export async function spendableFiat(
  balances: readonly { symbol: string; amount: unknown }[],
  fiat: string,
): Promise<Spendable> {
  const wallets: SpendableWallet[] = [];
  for (const b of balances) {
    const amount = Number(b.amount);
    if (!(amount > 0)) continue;
    const value = await sellValue(amount, b.symbol, fiat).catch(() => 0);
    if (value > 0) wallets.push({ symbol: b.symbol, amount, fiat: value });
  }
  wallets.sort((a, b) => b.fiat - a.fiat);
  return { fiat, total: wallets.reduce((sum, w) => sum + w.fiat, 0), wallets };
}
