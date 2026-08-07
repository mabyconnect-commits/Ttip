import "server-only";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  getAccount,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
} from "@solana/spl-token";
import bs58 from "bs58";
import { solanaConfig, type SolanaConfig } from "./config";

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

/**
 * A failure we detected BEFORE signing anything.
 *
 * The distinction is the whole difference between a safe refund and a double
 * spend. If nothing was broadcast, the caller can hand the user their balance
 * straight back; if we can't be sure, the withdrawal has to sit pending until
 * the chain says. That decision used to be made by pattern-matching the text of
 * an exception — so a treasury that ran out of SOL for fees produced a message
 * nobody had thought to match, and the withdrawal was held as "unconfirmed"
 * instead of refunded. Our own guards now say so in the type.
 */
export class TreasuryPreflightError extends Error {
  readonly preBroadcast = true;
  constructor(message: string) {
    super(message);
    this.name = "TreasuryPreflightError";
  }
}

/** True when nothing was signed or sent, so refunding cannot double-pay. */
export function isPreBroadcast(e: unknown): boolean {
  return e instanceof TreasuryPreflightError;
}

/**
 * Our float ran short — say so without saying it that way.
 *
 * "Treasury SOL balance is too low for this withdrawal" went straight to a
 * user's screen. It reads as though THEIR balance is short, which it isn't, and
 * there is nothing they can do about ours. So the user gets a sentence that is
 * true and actionable, and the operator gets the number they actually need,
 * loudly, in the logs — because this one is fixed by funding a wallet, and
 * nobody can fund a wallet they were never told was empty.
 */
function treasuryShort(asset: string, need: number, have: number, address: string): TreasuryPreflightError {
  console.error(
    `[solana] TREASURY SHORT — cannot pay out ${need} ${asset}: wallet ${address} holds ${have} ${asset}. Fund it.`,
  );
  return new TreasuryPreflightError(
    `${asset} withdrawals are paused for a few minutes while we top up our wallet. ` +
      `Your balance is untouched — try again shortly, or reach support if it persists.`,
  );
}

/**
 * Enough SOL left to pay for this transaction — checked before we build one.
 *
 * Every send from this wallet costs SOL, whatever it is sending. A treasury
 * holding plenty of USDC and no SOL can move nothing at all, and it fails deep
 * inside the RPC call with a message about lamports that no caller was reading:
 * the withdrawal was held "unconfirmed" rather than refunded, and the user was
 * left staring at Pending with their balance gone. Catch it here instead, where
 * it is unambiguously pre-broadcast.
 */
async function requireFeeReserve(conn: Connection, treasury: PublicKey): Promise<void> {
  const lamports = await conn.getBalance(treasury);
  const reserve = Math.round(solFeeReserve() * LAMPORTS_PER_SOL);
  if (lamports < reserve) {
    throw treasuryShort("SOL", solFeeReserve(), lamports / LAMPORTS_PER_SOL, treasury.toBase58());
  }
}

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
 * RPC endpoints to try, in order: the configured one(s) first, then public
 * fallbacks. SOLANA_RPC_URL may be a comma-separated list, so an operator can
 * put a paid endpoint first and keep a backup behind it.
 */
function rpcEndpoints(cfg: SolanaConfig): string[] {
  const configured = cfg.rpcUrl.split(",").map((s) => s.trim()).filter(Boolean);
  const fallbacks = [
    "https://api.mainnet-beta.solana.com",
    "https://solana-rpc.publicnode.com",
    "https://rpc.ankr.com/solana",
  ];
  return [...new Set([...configured, ...fallbacks])];
}

/**
 * A Connection on the first RPC endpoint that actually responds.
 *
 * The public default fails sends constantly ("Funding failed" with an empty
 * message), so we probe each endpoint cheaply and use the first live one. This
 * is chosen BEFORE any transaction is built, so the send still runs on exactly
 * ONE connection — there is no retry across endpoints and therefore no risk of
 * broadcasting the same transfer twice. If nothing responds it throws a
 * pre-broadcast error, so the withdrawal refunds cleanly instead of hanging.
 */
async function healthyConnection(cfg: SolanaConfig): Promise<Connection> {
  const endpoints = rpcEndpoints(cfg);
  let lastErr: unknown;
  for (const url of endpoints) {
    try {
      const conn = new Connection(url, "confirmed");
      await Promise.race([
        conn.getLatestBlockhash(),
        new Promise((_, rej) => setTimeout(() => rej(new Error("rpc probe timeout")), 4000)),
      ]);
      return conn;
    } catch (e) {
      lastErr = e;
    }
  }
  console.error(`[solana] no RPC endpoint responded (${endpoints.length} tried): ${String(lastErr)}`);
  throw new TreasuryPreflightError(
    "The network is busy right now — your balance is untouched, please try again in a moment.",
  );
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

  const conn = await healthyConnection(cfg);
  const treasury = loadKeypair(cfg.secretKey);
  const mint = new PublicKey(cfg.usdcMint);
  const to = new PublicKey(opts.toAddress);
  const amountRaw = BigInt(Math.round(opts.amount * 10 ** USDC_DECIMALS));

  // SOL for the fee, before anything else. USDC does not pay for its own transfer
  // (and opening the recipient's account costs rent), so a dry SOL wallet must
  // fail HERE — unambiguously pre-broadcast — not deep inside a send.
  await requireFeeReserve(conn, treasury.publicKey);

  // Associated token accounts. allowOwnerOffCurve: a provider deposit address can
  // be an off-curve PDA, which would otherwise throw TokenOwnerOffCurveError.
  const fromAta = await getAssociatedTokenAddress(mint, treasury.publicKey, true);
  const toAta = await getAssociatedTokenAddress(mint, to, true);

  // Treasury must exist and hold enough USDC.
  let held: bigint;
  try {
    held = (await getAccount(conn, fromAta)).amount;
  } catch {
    throw treasuryShort("USDC", opts.amount, 0, treasury.publicKey.toBase58());
  }
  if (held < amountRaw) {
    throw treasuryShort("USDC", opts.amount, Number(held) / 10 ** USDC_DECIMALS, treasury.publicKey.toBase58());
  }

  // ONE atomic transaction: create the recipient's token account if it's missing
  // (idempotent — no error if it already exists), then transfer. This replaces
  // getOrCreateAssociatedTokenAccount, whose create-then-read-back threw
  // TokenAccountNotFoundError when the RPC hadn't yet propagated the new account —
  // exactly the failure that stalled BNB withdrawals. Now the account and the
  // transfer land together, or nothing does.
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(treasury.publicKey, toAta, to, mint),
    createTransferInstruction(fromAta, toAta, treasury.publicKey, amountRaw),
  );
  const signature = await sendAndConfirmTransaction(conn, tx, [treasury], { commitment: "confirmed" });
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

  const conn = await healthyConnection(cfg);
  const treasury = loadKeypair(cfg.secretKey);
  const to = new PublicKey(opts.toAddress);

  const lamports = BigInt(Math.round(opts.amount * LAMPORTS_PER_SOL));
  if (lamports <= 0n) throw new Error("Amount is too small to send.");

  // Leave the wallet able to pay for the next transaction.
  const balance = await conn.getBalance(treasury.publicKey);
  const reserve = Math.round(solFeeReserve() * LAMPORTS_PER_SOL);
  if (BigInt(balance) < lamports + BigInt(reserve)) {
    throw treasuryShort(
      "SOL",
      opts.amount + reserve / LAMPORTS_PER_SOL,
      balance / LAMPORTS_PER_SOL,
      treasury.publicKey.toBase58(),
    );
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
    const conn = await healthyConnection(cfg);
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
