import "server-only";
import { dextopusConfig } from "./config";

/**
 * Dextopus crypto-deposit provider — cross-chain settlement across 70+ networks
 * (Bitcoin, Tron, Solana, every major EVM chain), non-custodial, ~0.25%/tx.
 *
 * A static per-user deposit address is generated once; whatever the user sends
 * (any supported origin chain/asset) is cross-chain-settled to your configured
 * treasury asset/address, and a signed webhook hits /api/webhooks/deposit —
 * which credits + sweeps via creditDeposit (resolving the user from the echoed
 * userId).
 *
 * API: https://swap-api.dextopus.com/llms.txt  (auth: `x-api-key: pk_...`)
 */

export interface DextopusAddress {
  id: string;
  address: string;
  originChainId: number;
  originAsset: string;
}

/**
 * Generate a reusable (static) deposit address for a user on a given origin
 * chain/asset. Settlement target (your treasury) comes from config. Returns null
 * when Dextopus isn't configured, so callers fall back to the demo generator.
 */
export async function createDepositAddress(
  userId: string,
  originChainId: number,
  originAsset: string,
): Promise<DextopusAddress | null> {
  const cfg = dextopusConfig();
  if (!cfg || cfg.settlementChainId == null || !cfg.settlementAsset || !cfg.settlementAddress) return null;

  const res = await fetch(`${cfg.baseUrl}/deposit/static/generate`, {
    method: "POST",
    headers: { "x-api-key": cfg.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      originChainId,
      originAsset,
      settlementChainId: cfg.settlementChainId,
      settlementAsset: cfg.settlementAsset,
      settlementAddress: cfg.settlementAddress,
      ...(cfg.refundTo ? { refundTo: cfg.refundTo } : {}),
      metadata: { source: "ttip" },
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => ({}))) as { data?: { id?: string; depositAddress?: string } };
  const address = json.data?.depositAddress;
  return address ? { id: json.data!.id ?? "", address, originChainId, originAsset } : null;
}

/** Register (or update) the deposit webhook URL + events with Dextopus. */
export async function configureWebhook(webhookUrl: string): Promise<boolean> {
  const cfg = dextopusConfig();
  if (!cfg) return false;
  const res = await fetch(`${cfg.baseUrl}/deposit/static/webhook`, {
    method: "POST",
    headers: { "x-api-key": cfg.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      webhookUrl,
      events: ["deposit.created", "deposit.completed", "deposit.failed", "deposit.refunded"],
    }),
  });
  return res.ok;
}
