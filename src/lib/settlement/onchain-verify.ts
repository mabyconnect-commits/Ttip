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

/** Public RPCs. Free, no key, no account. Override any of them via env. */
const RPC: Record<string, string> = {
  sol: process.env.RPC_SOLANA || "https://api.mainnet-beta.solana.com",
  erc20: process.env.RPC_ETHEREUM || "https://ethereum-rpc.publicnode.com",
  bep20: process.env.RPC_BSC || "https://bsc-rpc.publicnode.com",
  poly: process.env.RPC_POLYGON || "https://polygon-bor-rpc.publicnode.com",
  base: process.env.RPC_BASE || "https://base-rpc.publicnode.com",
  arb: process.env.RPC_ARBITRUM || "https://arbitrum-one-rpc.publicnode.com",
  op: process.env.RPC_OPTIMISM || "https://optimism-rpc.publicnode.com",
  avax: process.env.RPC_AVALANCHE || "https://avalanche-c-chain-rpc.publicnode.com",
};

/** EVM chains share one verifier; Solana needs its own. Anything else: unsupported. */
const EVM = new Set(["erc20", "bep20", "poly", "base", "arb", "op", "avax"]);

export interface OnchainCheck {
  /** True only when the chain itself confirms money arrived at the address. */
  verified: boolean;
  /** Base units actually received, as a string — never rounded through a float. */
  rawAmount?: string;
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
  const url = RPC[net];
  if (!url) return { verified: false, reason: `no RPC for network "${net}"` };
  if (!params.txHash) return { verified: false, reason: "no transaction hash" };

  try {
    if (net === "sol") return await verifySolana(url, params.txHash, params.address, params.token);
    if (EVM.has(net)) return await verifyEvm(url, params.txHash, params.address, params.token);
    return { verified: false, reason: `unsupported network "${net}"` };
  } catch (e) {
    // A node having a bad minute must never look like a bad deposit.
    return { verified: false, reason: `rpc failed: ${(e as Error).message.slice(0, 60)}` };
  }
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
    for (const log of receipt.logs ?? []) {
      if (log.address?.toLowerCase() !== contract) continue;
      if (log.topics?.[0]?.toLowerCase() !== TRANSFER_TOPIC) continue;
      // topics[2] is the padded recipient.
      const to = "0x" + (log.topics[2] ?? "").slice(-40).toLowerCase();
      if (to !== want) continue;
      const raw = BigInt(log.data || "0x0").toString();
      if (raw === "0") continue;
      return { verified: true, rawAmount: raw };
    }
    return { verified: false, reason: "no matching token transfer to this address" };
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
      preTokenBalances?: { owner?: string; mint?: string; uiTokenAmount?: { amount?: string } }[];
      postTokenBalances?: { owner?: string; mint?: string; uiTokenAmount?: { amount?: string } }[];
    };
    transaction?: { message?: { accountKeys?: ({ pubkey?: string } | string)[] } };
  } | null;

  if (!tx) return { verified: false, reason: "transaction not found on chain" };
  if (tx.meta?.err) return { verified: false, reason: "transaction failed" };

  if (token) {
    const before = new Map<string, bigint>();
    for (const b of tx.meta?.preTokenBalances ?? []) {
      if (b.owner === address && b.mint === token) before.set(b.mint, BigInt(b.uiTokenAmount?.amount ?? "0"));
    }
    for (const b of tx.meta?.postTokenBalances ?? []) {
      if (b.owner !== address || b.mint !== token) continue;
      const after = BigInt(b.uiTokenAmount?.amount ?? "0");
      const delta = after - (before.get(b.mint) ?? 0n);
      if (delta > 0n) return { verified: true, rawAmount: delta.toString() };
    }
    return { verified: false, reason: "no token balance increase for this address" };
  }

  const keys = (tx.transaction?.message?.accountKeys ?? []).map((k) =>
    typeof k === "string" ? k : k?.pubkey ?? "",
  );
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
