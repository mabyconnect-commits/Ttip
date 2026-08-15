import "server-only";

/**
 * Ask the blockchain, not the provider.
 *
 * THE permanent fix. Every deposit failure this app has had ends the same way:
 * the money is provably on-chain, in an address we issued, and Ttip won't credit
 * it because Dextopus hasn't flipped a status field. Production showed deposits
 * frozen at PENDING for over four days — not a confirmation delay, a stuck
 * pipeline — and while that flag is our only source of truth, a provider having
 * a bad week means our users are told their money doesn't exist.
 *
 * The chain does not have bad weeks. A confirmed transaction to a deposit
 * address is the strongest evidence there is, stronger than anything a provider
 * API can tell us, and it is available to anyone who asks.
 *
 * COST: nothing. These are the public RPC endpoints every wallet uses, called
 * only for a deposit that is already stuck — never on the happy path, where
 * Dextopus confirms in seconds and none of this runs. Every endpoint is
 * overridable by env if a paid node is ever preferred.
 */

/**
 * Public RPCs — several per chain, because one is not a plan.
 *
 * Production proved it: `bep20: rpc failed: rpc 403`. A single free endpoint
 * decided to refuse us, and BNB Chain — where a good part of the volume lands —
 * became unverifiable. A deposit must not go uncredited because one public node
 * is having a bad day, so each chain lists alternates and they are tried in
 * turn. Free, no key, no account, and the env var still wins when set.
 */
const RPC: Record<string, (string | undefined)[]> = {
  sol: [process.env.RPC_SOLANA, "https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"],
  erc20: [process.env.RPC_ETHEREUM, "https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com", "https://rpc.ankr.com/eth"],
  bep20: [process.env.RPC_BSC, "https://bsc-dataseed.binance.org", "https://bsc-dataseed1.defibit.io", "https://binance.llamarpc.com", "https://bsc-rpc.publicnode.com"],
  poly: [process.env.RPC_POLYGON, "https://polygon-rpc.com", "https://polygon-bor-rpc.publicnode.com"],
  base: [process.env.RPC_BASE, "https://mainnet.base.org", "https://base-rpc.publicnode.com"],
  arb: [process.env.RPC_ARBITRUM, "https://arb1.arbitrum.io/rpc", "https://arbitrum-one-rpc.publicnode.com"],
  op: [process.env.RPC_OPTIMISM, "https://mainnet.optimism.io", "https://optimism-rpc.publicnode.com"],
  avax: [process.env.RPC_AVALANCHE, "https://api.avax.network/ext/bc/C/rpc", "https://avalanche-c-chain-rpc.publicnode.com"],
};

/** The endpoints actually configured for a chain, env override first. */
function endpoints(net: string): string[] {
  return (RPC[net] ?? []).filter((u): u is string => Boolean(u && u.trim()));
}

/** EVM chains share one verifier; Solana needs its own. Anything else: unsupported. */
const EVM = new Set(["erc20", "bep20", "poly", "base", "arb", "op", "avax"]);

export interface OnchainCheck {
  /** True only when the chain itself confirms money arrived at the address. */
  verified: boolean;
  /** Base units actually received, as a string — never rounded through a float. */
  rawAmount?: string;
  /**
   * The mint/contract the chain says actually arrived.
   *
   * Not necessarily the one the provider claimed. When those disagree the chain
   * wins — it is the thing that actually happened.
   */
  asset?: string;
  /** Why not, when not. Always populated on failure so nothing fails silently. */
  reason?: string;
}

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

async function rpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`rpc ${res.status}`);
  const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new Error(String(body.error.message ?? "rpc error"));
  return body.result;
}

/**
 * Did `txHash` actually move `token` into `address` on `network`?
 *
 * Deliberately narrow. It answers one question and refuses to guess at any
 * other: an unsupported chain, an unreadable receipt or a transfer to somewhere
 * else all return verified:false with a reason. Crediting on a maybe is how a
 * deposit becomes a loss.
 */
export async function verifyOnChain(params: {
  network: string;
  txHash: string;
  address: string;
  /** Contract/mint address for a token, or omitted for the chain's own coin. */
  token?: string;
}): Promise<OnchainCheck> {
  const net = (params.network ?? "").trim().toLowerCase();
  const urls = endpoints(net);
  if (!urls.length) return { verified: false, reason: `no RPC for network "${net}"` };
  if (!params.txHash) return { verified: false, reason: "no transaction hash" };
  if (net !== "sol" && !EVM.has(net)) return { verified: false, reason: `unsupported network "${net}"` };

  let last = "no endpoint answered";
  for (const url of urls) {
    try {
      const r =
        net === "sol"
          ? await verifySolana(url, params.txHash, params.address, params.token)
          : await verifyEvm(url, params.txHash, params.address, params.token);
      // "Not found" can mean this node simply doesn't hold the history — try
      // the next one before concluding the transaction doesn't exist. Any other
      // answer is the chain's real verdict and is returned as-is.
      if (!r.verified && r.reason?.includes("not found")) {
        last = r.reason;
        continue;
      }
      return r;
    } catch (e) {
      // A node having a bad minute must never look like a bad deposit.
      last = `rpc failed: ${(e as Error).message.slice(0, 50)}`;
    }
  }
  return { verified: false, reason: last };
}

/**
 * EVM: the receipt is the proof.
 *
 * A successful receipt means the transaction is mined and did not revert. For a
 * token we read the ERC-20 Transfer log addressed to us — the value in the log,
 * not the value the provider claimed, because the log is what actually happened.
 */
async function verifyEvm(url: string, txHash: string, address: string, token?: string): Promise<OnchainCheck> {
  const receipt = (await rpc(url, "eth_getTransactionReceipt", [txHash])) as {
    status?: string;
    logs?: { address: string; topics: string[]; data: string }[];
  } | null;
  if (!receipt) return { verified: false, reason: "transaction not found on chain" };
  if (receipt.status !== "0x1") return { verified: false, reason: "transaction reverted" };

  const want = address.toLowerCase();

  if (token) {
    const contract = token.toLowerCase();

    // Every Transfer INTO our address in this transaction, whatever the
    // contract. The provider's asset field is a claim; the log is the event.
    const gains: { contract: string; raw: bigint }[] = [];
    for (const log of receipt.logs ?? []) {
      if (log.topics?.[0]?.toLowerCase() !== TRANSFER_TOPIC) continue;
      // topics[2] is the padded recipient.
      const to = "0x" + (log.topics[2] ?? "").slice(-40).toLowerCase();
      if (to !== want) continue;
      const raw = BigInt(log.data || "0x0");
      if (raw <= 0n) continue;
      gains.push({ contract: (log.address ?? "").toLowerCase(), raw });
    }

    const claimed = gains.find((g) => g.contract === contract);
    if (claimed) return { verified: true, rawAmount: claimed.raw.toString(), asset: claimed.contract };

    // Exactly one token reached us, so there is nothing to be confused about.
    // More than one and we cannot say which was the deposit — refuse.
    if (gains.length === 1) {
      return { verified: true, rawAmount: gains[0].raw.toString(), asset: gains[0].contract };
    }
    return {
      verified: false,
      reason: gains.length
        ? `${gains.length} different tokens arrived — cannot tell which is the deposit`
        : "no matching token transfer to this address",
    };
  }

  const tx = (await rpc(url, "eth_getTransactionByHash", [txHash])) as { to?: string; value?: string } | null;
  if (!tx) return { verified: false, reason: "transaction not found on chain" };
  if ((tx.to ?? "").toLowerCase() !== want) return { verified: false, reason: "sent to a different address" };
  const raw = BigInt(tx.value || "0x0").toString();
  if (raw === "0") return { verified: false, reason: "zero value" };
  return { verified: true, rawAmount: raw };
}

/**
 * Solana: the balance delta is the proof.
 *
 * Rather than parse instructions, compare the address's balance before and
 * after. It cannot be fooled by an unusual instruction layout, and it reports
 * what the account actually received.
 */
async function verifySolana(url: string, sig: string, address: string, token?: string): Promise<OnchainCheck> {
  const tx = (await rpc(url, "getTransaction", [
    sig,
    { maxSupportedTransactionVersion: 0, encoding: "jsonParsed" },
  ])) as {
    meta?: {
      err?: unknown;
      preBalances?: number[];
      postBalances?: number[];
      preTokenBalances?: { owner?: string; mint?: string; accountIndex?: number; uiTokenAmount?: { amount?: string } }[];
      postTokenBalances?: { owner?: string; mint?: string; accountIndex?: number; uiTokenAmount?: { amount?: string } }[];
    };
    transaction?: { message?: { accountKeys?: ({ pubkey?: string } | string)[] } };
  } | null;

  if (!tx) return { verified: false, reason: "transaction not found on chain" };
  if (tx.meta?.err) return { verified: false, reason: "transaction failed" };

  const keys = (tx.transaction?.message?.accountKeys ?? []).map((k) =>
    typeof k === "string" ? k : k?.pubkey ?? "",
  );

  if (token) {
    // Match on the OWNER or on the account itself.
    //
    // Solana holds tokens in an associated token account owned by the wallet,
    // and a provider may hand out either one as "the deposit address". Checking
    // only `owner` misses the case where the address we issued IS the token
    // account — which reads as "no token balance increase" on a deposit that
    // plainly arrived.
    const at = keys.indexOf(address);
    const mine = (b: { owner?: string; accountIndex?: number }) =>
      b.owner === address || (at >= 0 && b.accountIndex === at);

    const before = new Map<number, bigint>();
    for (const b of tx.meta?.preTokenBalances ?? []) {
      if (mine(b)) before.set(b.accountIndex ?? -1, BigInt(b.uiTokenAmount?.amount ?? "0"));
    }

    // Every mint that INCREASED for this address, regardless of which one the
    // provider said it would be. Their record is a claim; this is the event.
    const gains: { mint: string; delta: bigint }[] = [];
    for (const b of tx.meta?.postTokenBalances ?? []) {
      if (!mine(b)) continue;
      const after = BigInt(b.uiTokenAmount?.amount ?? "0");
      const delta = after - (before.get(b.accountIndex ?? -1) ?? 0n);
      if (delta > 0n && b.mint) gains.push({ mint: b.mint, delta });
    }

    // The claimed mint, when the chain agrees it arrived.
    const claimed = gains.find((g) => g.mint === token);
    if (claimed) return { verified: true, rawAmount: claimed.delta.toString(), asset: claimed.mint };

    // Otherwise: exactly one token arrived at our address in this transaction,
    // so there is no ambiguity about what was received — credit what the chain
    // says rather than refusing over a mint string the provider got wrong.
    // Two or more and we genuinely cannot tell which was the deposit, so we
    // refuse; guessing there would be inventing money.
    if (gains.length === 1) {
      return { verified: true, rawAmount: gains[0].delta.toString(), asset: gains[0].mint };
    }
    return {
      verified: false,
      reason: gains.length
        ? `${gains.length} different tokens arrived — cannot tell which is the deposit`
        : "no token balance increase for this address",
    };
  }

  const i = keys.indexOf(address);
  if (i < 0) return { verified: false, reason: "address not in transaction" };
  const delta = BigInt(tx.meta?.postBalances?.[i] ?? 0) - BigInt(tx.meta?.preBalances?.[i] ?? 0);
  if (delta <= 0n) return { verified: false, reason: "no balance increase for this address" };
  return { verified: true, rawAmount: delta.toString() };
}

/** Networks we can actually prove a deposit on. Anything else stays manual. */
export function canVerifyNetwork(network: string): boolean {
  const net = (network ?? "").trim().toLowerCase();
  return net === "sol" || EVM.has(net);
}

/**
 * Don't trust our own guess at the chain — ask all the plausible ones.
 *
 * The first live run refused a real stuck deposit with "transaction not found
 * on chain", because the network was derived from the label on our own
 * WalletAddress row. That label is our bookkeeping, not the truth: a user can
 * send USDC to an EVM address on any of seven chains, and asking only the one
 * we wrote down means a deposit on any of the other six is unprovable.
 *
 * The transaction hash says which FAMILY it belongs to — 0x + 64 hex is EVM,
 * base58 is Solana — so ask every chain in that family and take the first that
 * can prove it. Wrong-chain answers are misses, not false positives: a chain
 * that never saw the transaction simply says so.
 *
 * Still free, still only for deposits already stuck.
 */
export async function verifyAcrossChains(params: {
  txHash: string;
  address: string;
  token?: string;
  /** Checked first when we have a good guess; the rest still follow. */
  preferred?: string;
}): Promise<OnchainCheck> {
  const hash = (params.txHash ?? "").trim();
  if (!hash) return { verified: false, reason: "no transaction hash" };

  const isEvmHash = /^0x[0-9a-fA-F]{64}$/.test(hash);
  const family = isEvmHash ? [...EVM] : ["sol"];

  // An address that isn't 0x-shaped can't be an EVM recipient, and vice versa —
  // skip the impossible rather than spend a request proving it.
  const addrIsEvm = /^0x[0-9a-fA-F]{40}$/.test((params.address ?? "").trim());
  if (isEvmHash && !addrIsEvm) return { verified: false, reason: "EVM hash but the address isn't an EVM address" };

  const order = params.preferred && family.includes(params.preferred)
    ? [params.preferred, ...family.filter((f) => f !== params.preferred)]
    : family;

  const reasons: string[] = [];
  for (const network of order) {
    const r = await verifyOnChain({ ...params, network });
    if (r.verified) return r;
    reasons.push(`${network}: ${r.reason ?? "no"}`);
    // A transaction that exists but paid someone else is a definitive no —
    // no other chain is going to change that, so stop rather than fan out.
    if (r.reason?.includes("different address") || r.reason?.includes("reverted")) break;
  }
  return { verified: false, reason: reasons.slice(0, 3).join("; ").slice(0, 160) };
}
