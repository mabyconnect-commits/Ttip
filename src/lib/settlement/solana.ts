import "server-only";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, transfer } from "@solana/spl-token";
import bs58 from "bs58";
import { solanaConfig } from "./config";

/**
 * On-chain USDC (SPL) sends from the treasury Solana wallet — the live rail for
 * crypto withdrawals. Same asset, same chain: no swap, no third party. We sign
 * from the treasury keypair and broadcast; the returned signature is the tx hash
 * the withdrawal pipeline records once confirmed.
 *
 * Fails closed: if the treasury balance is short (or SOL for fees runs out) the
 * send throws, and the caller refunds the user's debited balance.
 */

const USDC_DECIMALS = 6;

/** USDC-SPL is the asset we can settle on Solana. */
export const SOLANA_WITHDRAW_ASSETS = ["USDC"];

/** Whether an asset can be withdrawn on-chain via the Solana treasury. */
export function solanaWithdrawSupported(asset: string): boolean {
  return !!solanaConfig() && SOLANA_WITHDRAW_ASSETS.includes(asset.toUpperCase());
}

/** Is `addr` a syntactically valid Solana (base58, on-curve/off-curve) address? */
export function isValidSolanaAddress(addr: string): boolean {
  try {
    // eslint-disable-next-line no-new
    new PublicKey(addr);
    return true;
  } catch {
    return false;
  }
}

function loadKeypair(secret: string): Keypair {
  const s = secret.trim();
  if (s.startsWith("[")) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(s) as number[]));
  return Keypair.fromSecretKey(bs58.decode(s));
}

/**
 * Send `amount` USDC to `toAddress` on Solana from the treasury wallet. Creates
 * the recipient's associated token account if it doesn't exist (treasury pays
 * the small rent). Returns the confirmed transaction signature.
 */
export async function sendSolanaUsdc(opts: { toAddress: string; amount: number }): Promise<{ txHash: string }> {
  const cfg = solanaConfig();
  if (!cfg) throw new Error("Solana treasury is not configured.");
  if (!(opts.amount > 0)) throw new Error("Enter a valid amount.");
  if (!isValidSolanaAddress(opts.toAddress)) throw new Error("Enter a valid Solana (USDC) address.");

  const conn = new Connection(cfg.rpcUrl, "confirmed");
  const treasury = loadKeypair(cfg.secretKey);
  const mint = new PublicKey(cfg.usdcMint);
  const to = new PublicKey(opts.toAddress);
  const amountRaw = BigInt(Math.round(opts.amount * 10 ** USDC_DECIMALS));

  // Treasury's USDC account — must exist and hold enough.
  const fromAta = await getOrCreateAssociatedTokenAccount(conn, treasury, mint, treasury.publicKey);
  if (fromAta.amount < amountRaw) throw new Error("Treasury USDC balance is too low for this withdrawal.");

  // Recipient's USDC account — create if missing (treasury pays rent).
  const toAta = await getOrCreateAssociatedTokenAccount(conn, treasury, mint, to);

  const signature = await transfer(conn, treasury, fromAta.address, toAta.address, treasury.publicKey, amountRaw);
  return { txHash: signature };
}
