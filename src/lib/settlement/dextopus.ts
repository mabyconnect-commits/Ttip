import "server-only";
import { dextopusConfig } from "./config";

/**
 * Dextopus crypto-deposit provider — cross-chain settlement across 70+ networks
 * (Bitcoin, Tron, Solana, every major EVM chain), non-custodial, with static
 * per-user deposit addresses. Protocol fee ~0.25%/tx; you can add your own
 * partner fee on top as extra revenue.
 *
 * Deposits arrive at /api/webhooks/deposit (verified with the Dextopus secret),
 * are normalized by parseDeposit(), then credited + swept into treasury by
 * creditDeposit — the same path every deposit provider uses.
 *
 * Docs: https://dextopus.gitbook.io/dextopus-docs
 */

export interface DextopusAddress {
  address: string;
  asset: string;
  chain: string;
}

/**
 * Create (or fetch) a static deposit address for a user on a given chain.
 * Confirm the exact endpoint/payload against the Dextopus API reference. Returns
 * null when Dextopus isn't configured, so the caller can fall back to the
 * built-in demo address generator.
 */
export async function createDepositAddress(
  reference: string,
  asset: string,
  chain: string,
): Promise<DextopusAddress | null> {
  const cfg = dextopusConfig();
  if (!cfg) return null;

  const res = await fetch(`${cfg.baseUrl}/v1/deposit/address`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ reference, asset, chain }),
  });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => ({}))) as { address?: string; data?: { address?: string } };
  const address = json.address ?? json.data?.address;
  return address ? { address, asset, chain } : null;
}
