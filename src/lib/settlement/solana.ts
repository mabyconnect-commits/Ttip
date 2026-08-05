import "server-only";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, getAssociatedTokenAddress, transfer } from "@solana/spl-token";
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

/**
 * What the Solana treasury can settle directly.
 *
 * SOL is here because it CANNOT go the other way. Dextopus lists it as the
 * native sentinel (0xEeee…EEeE) and its quote endpoint refuses that as a
 * destination — "SOL can't be withdrawn on this network" was the provider
 * talking, not a policy of ours. But the treasury wallet holds SOL and we sign
 * for it, so a native transfer is the shorter path anyway: same chain, no
 * bridge, no counterparty.
 */
export const SOLANA_WITHDRAW_ASSETS = ["USDC", "SOL"];

/**
 * SOL the treasury keeps back for its own transaction fees.
 *
 * Every USDC send, and every token account this wallet creates for a recipient,
 * is paid for in SOL from this same balance. Emptying it into a withdrawal
 * would strand every other withdrawal behind it. Override with
 * SOLANA_FEE_RESERVE_SOL.
 */
export function solFeeReserve(): number {
  const raw = Number(process.env.SOLANA_FEE_RESERVE_SOL);
  return Number.isFinite(raw) && raw >= 0 ? raw : 0.05;
}

/**
 * The minimum a Solana account must hold to exist at all (rent exemption).
 * Sending less than this to an address that has never been funded fails on
 * chain, so it's refused up front with a reason rather than at broadcast.
 */
const RENT_EXEMPT_SOL = 0.00089088;

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
  // allowOwnerOffCurve: provider deposit addresses can be off-curve (PDAs), which
  // would otherwise throw TokenOwnerOffCurveError; a normal wallet is unaffected.
  const toAta = await getOrCreateAssociatedTokenAccount(conn, treasury, mint, to, true);

  const signature = await transfer(conn, treasury, fromAta.address, toAta.address, treasury.publicKey, amountRaw);
  return { txHash: signature };
}

/**
 * Send native SOL from the treasury wallet.
 *
 * A plain system transfer — no token account, no rent for the recipient beyond
 * what the transfer itself carries. Fails closed on every count that matters:
 * a short balance, a fee reserve that would be eaten, and an amount too small
 * to leave the recipient rent-exempt if their account is empty.
 */
export async function sendSolanaNative(opts: { toAddress: string; amount: number }): Promise<{ txHash: string }> {
  const cfg = solanaConfig();
  if (!cfg) throw new Error("Solana treasury is not configured.");
  if (!(opts.amount > 0)) throw new Error("Enter a valid amount.");
  if (!isValidSolanaAddress(opts.toAddress)) throw new Error("Enter a valid Solana address.");

  const conn = new Connection(cfg.rpcUrl, "confirmed");
  const treasury = loadKeypair(cfg.secretKey);
  const to = new PublicKey(opts.toAddress);

  const lamports = BigInt(Math.round(opts.amount * LAMPORTS_PER_SOL));
  if (lamports <= 0n) throw new Error("Amount is too small to send.");

  // Leave the wallet able to pay for the next transaction.
  const balance = await conn.getBalance(treasury.publicKey);
  const reserve = Math.round(solFeeReserve() * LAMPORTS_PER_SOL);
  if (BigInt(balance) < lamports + BigInt(reserve)) {
    throw new Error("Treasury SOL balance is too low for this withdrawal.");
  }

  // An account that doesn't exist yet has to be left rent-exempt, or the
  // transfer is rejected on chain and the user is told nothing useful.
  const info = await conn.getAccountInfo(to);
  if (!info && opts.amount < RENT_EXEMPT_SOL) {
    throw new Error(`That wallet is empty, so the first transfer to it must be at least ${RENT_EXEMPT_SOL} SOL.`);
  }

  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: treasury.publicKey, toPubkey: to, lamports }),
  );
  const signature = await sendAndConfirmTransaction(conn, tx, [treasury], { commitment: "confirmed" });
  return { txHash: signature };
}

/**
 * Read the treasury Solana wallet's SOL + USDC balances and the address the
 * configured keypair actually controls — so an operator can confirm the signer
 * matches the funded wallet. Returns null if Solana isn't configured.
 */
export async function treasurySolanaBalances(): Promise<{ address: string; sol: number; usdc: number } | null> {
  const cfg = solanaConfig();
  if (!cfg) return null;
  try {
    const conn = new Connection(cfg.rpcUrl, "confirmed");
    const treasury = loadKeypair(cfg.secretKey);
    const lamports = await conn.getBalance(treasury.publicKey);
    let usdc = 0;
    try {
      const ata = await getAssociatedTokenAddress(new PublicKey(cfg.usdcMint), treasury.publicKey, true);
      const bal = await conn.getTokenAccountBalance(ata);
      usdc = Number(bal.value.uiAmount ?? 0);
    } catch {
      /* no USDC token account */
    }
    return { address: treasury.publicKey.toBase58(), sol: lamports / 1e9, usdc };
  } catch {
    return null;
  }
}
