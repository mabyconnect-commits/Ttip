import "server-only";
import { prisma } from "../db";
import { CRYPTO_ASSETS } from "../constants";
import { depositProvider, dextopusConfig } from "./config";
import { createDepositAddress } from "./dextopus";

/**
 * Provision real Dextopus static deposit addresses for a user, lazily and
 * idempotently. Called when the deposit screen loads; if Dextopus isn't
 * configured it's a no-op and the built-in demo addresses stay in place.
 *
 * The app's network id → Dextopus numeric chainId. The EVM ids are the standard
 * EIP-155 values; Tron/others are provider-specific — verify against
 * `GET /deposit/chains` and override with the DEXTOPUS_CHAIN_IDS env (JSON).
 * Networks with no mapping keep their demo address.
 */
// Verified against Dextopus GET /api/deposit/chains.
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

  let created = 0;
  for (const asset of CRYPTO_ASSETS.filter((a) => RECEIVE_ASSETS.includes(a.symbol))) {
    for (const net of asset.networks) {
      const chainId = map[net.id];
      if (!chainId) continue; // unmapped chain → keep demo address
      if (have.has(`${asset.symbol}:${net.label}`)) continue; // already provisioned

      const res = await createDepositAddress(userId, chainId, asset.symbol).catch(() => null);
      if (!res) continue;

      await prisma.walletAddress.upsert({
        where: { userId_symbol_network: { userId, symbol: asset.symbol, network: net.label } },
        create: { userId, symbol: asset.symbol, network: net.label, address: res.address, provider: "dextopus" },
        update: { address: res.address, provider: "dextopus" },
      });
      created++;
    }
  }
  return created;
}
