import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { CRYPTO_ASSETS } from "./constants";
import crypto from "crypto";

const GRADIENTS = [
  "135deg,#6D5BFF,#2AC8FF 60%,#3DF5B0",
  "135deg,#FF9A5B,#FF5B8F",
  "135deg,#2AC8FF,#3DF5B0",
  "135deg,#6D5BFF,#B45BFF",
  "135deg,#FFC85B,#FF7A8A",
];

export function pickGradient(seed: string): string {
  const n = crypto.createHash("md5").update(seed).digest()[0];
  return GRADIENTS[n % GRADIENTS.length];
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const HEX = "0123456789abcdef";

function rand(chars: string, len: number, seed: string): string {
  const h = crypto.createHash("sha256").update(seed).digest();
  let out = "";
  for (let i = 0; i < len; i++) out += chars[h[i % h.length] % chars.length];
  return out;
}

/** Deterministic, realistic-looking (but non-custodial demo) deposit addresses. */
export function generateAddress(network: string, seed: string): string {
  const s = network + ":" + seed;
  switch (network) {
    case "trc20":
      return "T" + rand(B58, 33, s);
    case "erc20":
    case "bep20":
    case "poly":
    case "avax":
      return "0x" + rand(HEX, 40, s);
    case "btc":
      return "bc1q" + rand(B58, 38, s).toLowerCase();
    case "ltc":
      return "ltc1q" + rand(B58, 38, s).toLowerCase();
    case "sol":
      return rand(B58, 44, s);
    case "xrp":
      return "r" + rand(B58, 33, s);
    case "ada":
      return "addr1" + rand(B58, 50, s).toLowerCase();
    case "doge":
      return "D" + rand(B58, 33, s);
    case "dot":
      return "1" + rand(B58, 47, s);
    case "ton":
      return "EQ" + rand(B58, 46, s);
    default:
      return "0x" + rand(HEX, 40, s);
  }
}

const REFCHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function makeReferralCode(username: string): string {
  const suffix = rand(REFCHARS, 4, username + Date.now());
  return (username.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase() || "TTIP") + suffix;
}

interface ProvisionOpts {
  seed?: boolean; // give demo starting balances
}

/** Create balances, deposit addresses and a virtual card for a fresh user. */
export async function provisionAccount(
  tx: Prisma.TransactionClient,
  userId: string,
  name: string,
  opts: ProvisionOpts = {},
): Promise<void> {
  const seedBalances: Record<string, number> = opts.seed
    ? { USDT: 612.5, BTC: 0.0182, ETH: 0.041, NGN: 0 }
    : { USDT: 0 };

  for (const [symbol, amount] of Object.entries(seedBalances)) {
    const kind = ["NGN", "GHS", "KES", "ZAR", "USD"].includes(symbol) ? "fiat" : "crypto";
    await tx.balance.create({
      data: { userId, symbol, kind, amount: new Prisma.Decimal(amount) },
    });
  }

  // deposit addresses for the primary receive assets
  const receiveAssets = CRYPTO_ASSETS.filter((a) => ["USDT", "USDC", "BTC", "ETH", "SOL"].includes(a.symbol));
  for (const asset of receiveAssets) {
    for (const net of asset.networks) {
      await tx.walletAddress.create({
        data: {
          userId,
          symbol: asset.symbol,
          network: net.label,
          address: generateAddress(net.id, userId + asset.symbol + net.id),
        },
      });
    }
  }

  // virtual USD card
  const last4 = rand("0123456789", 4, userId + "card");
  await tx.card.create({
    data: {
      userId,
      last4,
      holder: name.toUpperCase(),
      balanceUsd: new Prisma.Decimal(opts.seed ? 482.1 : 0),
      expMonth: 11,
      expYear: 2029,
    },
  });
}
