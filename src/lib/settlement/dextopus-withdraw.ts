import "server-only";
import { dextopusConfig, dextopusWithdrawEnabled, dextopusPartnerFees, solanaConfig } from "./config";
import { resolveTokenAddress } from "./dextopus";
import { sendSolanaUsdc, isPreBroadcast } from "./solana";
import { toUsd, hasUsdPrice } from "../prices";
import { chainIdForNetwork } from "../chains";

/**
 * Dextopus withdrawal — send crypto OUT to a user's external wallet on any chain.
 *
 * Dextopus withdrawals reuse the deposit endpoints: we ask for a withdrawal
 * "quote" pre-wired to the user's destination (chain, token, external address),
 * Dextopus returns an address WE fund from treasury, then it converts and
 * delivers to the user. Our treasury settles in Solana USDC, so we fund that
 * address with the on-chain Solana signer (solana.ts) — the same rail that does
 * direct USDC-on-Solana sends.
 *
 * Money-safety (no double spend):
 *   - Everything up to and including the quote moves NO money → any failure there
 *     returns "failed" so the pipeline refunds the user.
 *   - The single money-moving step is funding the Dextopus address. A pre-broadcast
 *     failure (treasury short, bad address) is a safe "failed" (refund). Anything
 *     ambiguous (the send may have broadcast) returns "pending" and is left for
 *     status reconciliation — we NEVER refund AND deliver.
 *   - Delivery to the user completes asynchronously; the withdrawal stays pending
 *     until GET /deposit/status reports it settled (or failed/expired → refund).
 */

const SOLANA_CHAIN_ID = 792703809;
const USDC_DECIMALS = 6;

export interface DxWithdrawRequest {
  asset: string; // what the user receives, e.g. USDT
  network?: string; // destination network label/id, e.g. "TRC-20 (Tron)"
  chainId?: number; // explicit Dextopus destination chain id (from the dynamic picker)
  address: string; // user's external wallet on the destination chain
  amount: number; // amount of `asset` the user is withdrawing
  reference: string; // our idempotency reference
}

export interface DxWithdrawResult {
  status: "pending" | "failed";
  providerRef?: string; // Dextopus deposit-request id, for status polling
  fundingTx?: string; // our on-chain funding tx signature
  message?: string;
}

function pick<T = unknown>(obj: any, ...keys: string[]): T | undefined {
  const root = obj?.data ?? obj;
  for (const k of keys) if (root?.[k] != null) return root[k] as T;
  for (const k of keys) if (obj?.[k] != null) return obj[k] as T;
  return undefined;
}

export async function dextopusWithdraw(req: DxWithdrawRequest): Promise<DxWithdrawResult> {
  const cfg = dextopusConfig();
  if (!cfg || !dextopusWithdrawEnabled()) return { status: "failed", message: "Dextopus withdrawal is not configured." };
  if (cfg.settlementChainId == null || !cfg.settlementAsset || !cfg.settlementAddress) {
    return { status: "failed", message: "Dextopus treasury settlement is not configured." };
  }
  // We fund the withdrawal from the treasury's settlement asset. Only a Solana
  // USDC treasury has an in-process signer, so require that as the origin.
  if (cfg.settlementChainId !== SOLANA_CHAIN_ID || !solanaConfig()) {
    return { status: "failed", message: "Treasury signer only supports a Solana (USDC) origin." };
  }

  const destinationChainId = req.chainId ?? chainIdForNetwork(req.network);
  if (!destinationChainId) return { status: "failed", message: `Unsupported network for ${req.asset}.` };

  // We size the treasury's side of this in dollars, so an asset we can't price
  // would be sized by a guess. usdPrice falls back to $1 per unit, which turned
  // "2 PENGU" into "$2" and quoted 287 PENGU back. Refuse instead.
  if (!(await hasUsdPrice(req.asset))) {
    return { status: "failed", message: `We can't price ${req.asset} right now, so we won't send it.` };
  }

  const [originAsset, destinationAsset] = await Promise.all([
    resolveTokenAddress(cfg, cfg.settlementChainId, cfg.settlementAsset),
    resolveTokenAddress(cfg, destinationChainId, req.asset),
  ]);
  if (!originAsset) return { status: "failed", message: "Treasury asset not resolvable on Dextopus." };
  if (!destinationAsset) return { status: "failed", message: `${req.asset} isn't available on the selected network.` };

  // Origin amount to send = USD value of the withdrawal (treasury asset is USDC ≈ USD).
  const usdc = await toUsd(req.amount, req.asset);
  if (!(usdc > 0)) return { status: "failed", message: "Amount is too small." };
  const amountSmallest = Math.round(usdc * 10 ** USDC_DECIMALS).toString();
  const partnerFees = dextopusPartnerFees();

  // 1. Create the withdrawal request — no money moves yet. Any failure → refund.
  let quote: any;
  try {
    const res = await fetch(`${cfg.baseUrl}/deposit/quote`, {
      method: "POST",
      headers: { "x-api-key": cfg.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        originChainId: cfg.settlementChainId,
        originAsset,
        destinationChainId,
        destinationAsset,
        amount: amountSmallest,
        recipient: req.address, // withdrawal: recipient is the user's external wallet
        refundTo: cfg.settlementAddress, // failed/expired funds come back to treasury
        ...(partnerFees ? { partnerFees } : {}),
        metadata: { source: "ttip-withdrawal", reference: req.reference },
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { status: "failed", message: (body as any)?.message || `Dextopus quote failed (${res.status}).` };
    }
    quote = await res.json();
  } catch (e) {
    return { status: "failed", message: `Couldn't reach Dextopus: ${String(e)}` };
  }

  const depositAddress = pick<string>(quote, "depositAddress", "address");
  const requestId = pick<string | number>(quote, "depositRequestId", "requestId", "id");
  if (!depositAddress) return { status: "failed", message: "Dextopus did not return a funding address." };

  // 2. Fund the address from the Solana treasury — the ONLY money-moving step.
  let fundingTx: string;
  try {
    const sent = await sendSolanaUsdc({ toAddress: depositAddress, amount: usdc });
    fundingTx = sent.txHash;
  } catch (e) {
    const msg = (e as Error).message || "Funding failed";
    // Pre-broadcast failures never moved funds → safe to fail (refund).
    //
    // Our own guards say so in the type. The regex stays for the messages that
    // come back from the RPC rather than from us, but it must not be the only
    // thing standing between a user and their refund: an empty fee wallet threw
    // a lamports error nobody had thought to match, and the withdrawal sat
    // "unconfirmed" with the user's balance already taken.
    if (isPreBroadcast(e) || /too low|valid|configured|amount/i.test(msg)) {
      return { status: "failed", message: msg };
    }
    // Ambiguous (may have broadcast) → leave pending; ops/status reconcile. Never refund + deliver.
    return { status: "pending", providerRef: String(requestId ?? ""), message: `Funding unconfirmed — will reconcile: ${msg}` };
  }

  // 3. Best-effort: tell Dextopus we funded, to speed up detection. Never fails the withdrawal.
  try {
    await fetch(`${cfg.baseUrl}/deposit/submit`, {
      method: "POST",
      headers: { "x-api-key": cfg.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ depositRequestId: requestId, depositAddress, txHash: fundingTx }),
    });
  } catch {
    /* detection will still happen automatically */
  }

  // Funded. Delivery to the user completes async → pending until status confirms.
  return { status: "pending", providerRef: String(requestId ?? ""), fundingTx };
}

/**
 * Dry-run a withdrawal to validate the whole route WITHOUT moving money: checks
 * the destination asset is supported (Dextopus doesn't deliver native coins like
 * SOL/ETH/BTC — only tokens), the recipient address is valid, and the amount
 * clears any minimum. Call this before debiting the user so a bad request never
 * touches their balance. Returns the expected output amount on success.
 */
export async function dextopusWithdrawPreview(req: DxWithdrawRequest): Promise<{ ok: boolean; amountOut?: number; message?: string }> {
  const cfg = dextopusConfig();
  if (!cfg || !dextopusWithdrawEnabled()) return { ok: false, message: "Withdrawals aren't available right now." };
  if (cfg.settlementChainId == null || !cfg.settlementAsset || !cfg.settlementAddress) return { ok: false, message: "Withdrawal treasury isn't configured." };
  const destinationChainId = req.chainId ?? chainIdForNetwork(req.network);
  if (!destinationChainId) return { ok: false, message: `Unsupported network for ${req.asset}.` };
  // Same reason as the send path: no price, no quote. See dextopusWithdraw.
  if (!(await hasUsdPrice(req.asset))) {
    return { ok: false, message: `We can't price ${req.asset} right now, so we can't quote this withdrawal.` };
  }

  const [originAsset, destinationAsset] = await Promise.all([
    resolveTokenAddress(cfg, cfg.settlementChainId, cfg.settlementAsset),
    resolveTokenAddress(cfg, destinationChainId, req.asset),
  ]);
  if (!originAsset) return { ok: false, message: "Treasury asset couldn't be resolved." };
  if (!destinationAsset) return { ok: false, message: `${req.asset} isn't available on the selected network.` };
  const usdc = await toUsd(req.amount, req.asset);
  if (!(usdc > 0)) return { ok: false, message: "Amount is too small." };

  try {
    const res = await fetch(`${cfg.baseUrl}/deposit/quote`, {
      method: "POST",
      headers: { "x-api-key": cfg.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        originChainId: cfg.settlementChainId,
        originAsset,
        destinationChainId,
        destinationAsset,
        amount: Math.round(usdc * 10 ** USDC_DECIMALS).toString(),
        recipient: req.address,
        refundTo: cfg.settlementAddress,
        dry: true,
        metadata: { source: "ttip-withdrawal-preview" },
      }),
    });
    const body = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || body?.success === false) {
      return { ok: false, message: friendlyQuoteError(body?.message, req.asset) };
    }
    // amountOut is in the destination token's smallest units — convert to human.
    const raw = Number(pick<number | string>(body, "amountOut") ?? 0);
    const decimals = await tokenDecimals(cfg, destinationChainId, req.asset);
    return { ok: true, amountOut: raw / 10 ** decimals };
  } catch (e) {
    return { ok: false, message: `Couldn't reach the withdrawal provider: ${String(e)}` };
  }
}

/** Decimals for a token on a chain (from Dextopus's token list); defaults to 6. */
async function tokenDecimals(cfg: NonNullable<ReturnType<typeof dextopusConfig>>, chainId: number, symbol: string): Promise<number> {
  try {
    const res = await fetch(`${cfg.baseUrl}/deposit/tokens?chainId=${chainId}`, { headers: { "x-api-key": cfg.apiKey } });
    const body = (await res.json().catch(() => null)) as any;
    const list = Array.isArray(body) ? body : (body?.tokens ?? body?.data);
    const hit = (list ?? []).find((t: any) => String(t.symbol ?? "").toUpperCase() === symbol.toUpperCase());
    const d = Number(hit?.decimals);
    return Number.isFinite(d) && d > 0 ? d : 6;
  } catch {
    return 6;
  }
}

/** Turn a raw Dextopus quote error into something a user can act on. */
function friendlyQuoteError(message: string | undefined, asset: string): string {
  const m = (message ?? "").toString();
  if (/not supported on chain|native/i.test(m) && /0xEeee/i.test(m)) {
    return `${asset} can't be withdrawn on this network — it's a native coin. Choose a token like USDC or USDT instead.`;
  }
  if (/recipient must be a valid/i.test(m)) return "That wallet address isn't valid for the selected network.";
  if (/minimum|too small|too low/i.test(m)) return "Amount is below the withdrawal minimum for this asset/network.";
  return m || "This withdrawal can't be processed on the selected network.";
}

export interface DxStatus {
  settled: boolean;
  failed: boolean;
  /** Dextopus is still waiting for us to fund it (no deposit received yet). */
  awaitingDeposit: boolean;
  destinationTxHash?: string;
  raw?: unknown;
}

/** Poll a withdrawal's execution status by its Dextopus request id. */
export async function dextopusWithdrawStatus(requestId: string): Promise<DxStatus | null> {
  const cfg = dextopusConfig();
  if (!cfg || !requestId) return null;
  const res = await fetch(`${cfg.baseUrl}/deposit/status?depositRequestId=${encodeURIComponent(requestId)}`, {
    headers: { "x-api-key": cfg.apiKey },
  });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as any;
  if (!json) return null;
  // Dextopus exposes both `status` and `executionStatus`; check both.
  const status = String(pick(json, "status") ?? "").toLowerCase();
  const exec = String(pick(json, "executionStatus") ?? "").toLowerCase();
  const both = `${status} ${exec}`;
  const hashes = pick<string[]>(json, "destinationTransactionHashes");
  return {
    settled: /complete|settled|delivered|success/.test(both),
    failed: /fail|expired|refund|error/.test(both),
    awaitingDeposit: /pending_deposit|awaiting_deposit|no_deposit|not_received/.test(both),
    destinationTxHash: Array.isArray(hashes) ? hashes[0] : undefined,
    raw: json,
  };
}

/** Validate a user's external address for its chain type before quoting. */
export async function dextopusValidateAddress(chainType: string, address: string): Promise<{ valid: boolean; reason?: string }> {
  const cfg = dextopusConfig();
  if (!cfg) return { valid: false, reason: "not configured" };
  try {
    const res = await fetch(`${cfg.baseUrl}/deposit/validate-address`, {
      method: "POST",
      headers: { "x-api-key": cfg.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ chainType, address }),
    });
    const json = (await res.json().catch(() => ({}))) as any;
    return { valid: !!pick(json, "valid"), reason: pick<string>(json, "reason") };
  } catch {
    return { valid: false, reason: "validation unavailable" };
  }
}

/** Map a Dextopus numeric chain id to its address chainType (evm|solana|tron|bitcoin). */
export function chainTypeForChainId(chainId: number | null): string {
  if (chainId === SOLANA_CHAIN_ID) return "solana";
  if (chainId === 728126428) return "tron";
  if (chainId === 8253038) return "bitcoin";
  return "evm";
}
