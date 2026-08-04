import "server-only";
import { prisma } from "../db";
import { CRYPTO_ASSETS } from "../constants";
import { depositProvider, dextopusConfig } from "./config";
import { createDepositAddress, chainFamily, type ChainFamily } from "./dextopus";

/**
 * On-demand: return the user's static deposit address for one (chain, asset),
 * generating + persisting it the first time. This is what powers the "pick any
 * chain / any token" deposit flow — an address is minted only when a user
 * actually selects that combination. `network` is the human chain name and part
 * of the unique key (so USDC-on-Ethereum ≠ USDC-on-Polygon).
 */
export async function getOrCreateDepositAddress(
  userId: string,
  chainId: number,
  symbol: string,
  network: string,
): Promise<{ address: string; network: string; symbol: string } | null> {
  const existing = await prisma.walletAddress.findFirst({ where: { userId, symbol, network, provider: "dextopus" } });
  if (existing) return { address: existing.address, network, symbol };

  const res = await createDepositAddress(userId, chainId, symbol).catch(() => null);
  if (!res) return null;

  await prisma.walletAddress.upsert({
    where: { userId_symbol_network: { userId, symbol, network } },
    create: { userId, symbol, network, address: res.address, provider: "dextopus" },
    update: { address: res.address, provider: "dextopus" },
  });
  return { address: res.address, network, symbol };
}

/**
 * Provision real Dextopus static deposit addresses for a user, lazily and
 * idempotently. Called when the deposit screen loads; if Dextopus isn't
 * configured it's a no-op and the built-in demo addresses stay in place.
 *
 * The app's network id → Dextopus numeric chainId. The EVM ids are the standard
 * EIP-155 values; Solana, Tron and Bitcoin get synthetic ids from the provider.
 * Verify against `GET /api/deposit/tokens` (which returns every chain with its
 * tokens inline) and override with the DEXTOPUS_CHAIN_IDS env (JSON). Networks
 * with no mapping keep their demo address.
 */
// Verified against the Dextopus catalog.
const DEFAULT_CHAIN_IDS: Record<string, number> = {
  erc20: 1, // Ethereum
  bep20: 56, // BNB Smart Chain
  poly: 137, // Polygon
  avax: 43114, // Avalanche C-Chain
  trc20: 728126428, // Tron
  sol: 792703809, // Solana
  btc: 8253038, // Bitcoin
};

function chainIds(): Record<string, number> {
  try {
    const override = process.env.DEXTOPUS_CHAIN_IDS ? JSON.parse(process.env.DEXTOPUS_CHAIN_IDS) : {};
    return { ...DEFAULT_CHAIN_IDS, ...override };
  } catch {
    return DEFAULT_CHAIN_IDS;
  }
}

// Assets we auto-provision addresses for, across each of their supported
// networks. Every one settles to your treasury (Solana USDC) via Dextopus.
const RECEIVE_ASSETS = ["USDT", "USDC", "BTC", "ETH", "SOL", "BNB"];

export async function ensureDepositAddresses(userId: string): Promise<number> {
  if (depositProvider() !== "dextopus") return 0;
  const cfg = dextopusConfig();
  if (!cfg || cfg.settlementChainId == null || !cfg.settlementAsset || !cfg.settlementAddress) return 0;

  const map = chainIds();
  const existing = await prisma.walletAddress.findMany({ where: { userId, provider: "dextopus" } });
  const have = new Set(existing.map((a) => `${a.symbol}:${a.network}`));

  // Collect the (asset, chain) pairs still needing an address.
  const tasks: { symbol: string; network: string; chainId: number }[] = [];
  for (const asset of CRYPTO_ASSETS.filter((a) => RECEIVE_ASSETS.includes(a.symbol))) {
    for (const net of asset.networks) {
      const chainId = map[net.id];
      if (!chainId) continue; // unmapped chain → keep demo address
      if (have.has(`${asset.symbol}:${net.label}`)) continue; // already provisioned
      tasks.push({ symbol: asset.symbol, network: net.label, chainId });
    }
  }

  // One address per FAMILY, not per (asset, chain).
  //
  // Dextopus mints a single reusable address per family and every chain+token
  // inside that family settles through it. Minting per task would fire a dozen
  // concurrent POSTs for the same tuple — racing each other to create
  // duplicates of an address they all end up sharing anyway. So mint once per
  // family, then fan the result out to every row that family covers.
  const families = new Map<ChainFamily, { chainId: number; symbol: string }>();
  for (const t of tasks) {
    const family = chainFamily(t.chainId);
    if (!families.has(family)) families.set(family, { chainId: t.chainId, symbol: t.symbol });
  }

  const minted = new Map<ChainFamily, string>();
  await Promise.all(
    [...families].map(async ([family, seed]) => {
      const res = await createDepositAddress(userId, seed.chainId, seed.symbol).catch(() => null);
      if (res) minted.set(family, res.address);
    }),
  );

  let count = 0;
  for (const t of tasks) {
    const address = minted.get(chainFamily(t.chainId));
    if (!address) continue; // that family didn't mint — keep the demo address
    await prisma.walletAddress.upsert({
      where: { userId_symbol_network: { userId, symbol: t.symbol, network: t.network } },
      create: { userId, symbol: t.symbol, network: t.network, address, provider: "dextopus" },
      update: { address, provider: "dextopus" },
    });
    count += 1;
  }
  return count;
}
