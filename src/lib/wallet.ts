import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { ApiError } from "./api";
import { CRYPTO_BY_SYMBOL, FIAT_BY_CODE } from "./constants";
import { getPrices, toUsd } from "./prices";

type Tx = Prisma.TransactionClient;

export function kindOf(symbol: string): "crypto" | "fiat" {
  return FIAT_BY_CODE[symbol] ? "fiat" : "crypto";
}

/** Read a balance amount as a JS number (0 if none). */
export async function balanceOf(userId: string, symbol: string, client: Tx | typeof prisma = prisma): Promise<number> {
  const b = await client.balance.findUnique({ where: { userId_symbol: { userId, symbol } } });
  return b ? Number(b.amount) : 0;
}

/** Add `amount` (may be negative) to a balance, creating it if needed. Throws on overdraft. */
export async function adjust(client: Tx, userId: string, symbol: string, amount: number): Promise<void> {
  const existing = await client.balance.findUnique({ where: { userId_symbol: { userId, symbol } } });
  const current = existing ? Number(existing.amount) : 0;
  const next = current + amount;
  if (next < -1e-9) {
    throw new ApiError(`Insufficient ${symbol} balance`, 400);
  }
  await client.balance.upsert({
    where: { userId_symbol: { userId, symbol } },
    create: { userId, symbol, kind: kindOf(symbol), amount: new Prisma.Decimal(Math.max(0, next)) },
    update: { amount: new Prisma.Decimal(Math.max(0, next)) },
  });
}

export interface PortfolioAsset {
  symbol: string;
  kind: "crypto" | "fiat";
  name: string;
  color: string;
  glyph: string;
  amount: number;
  usdValue: number;
  fiatValue: number;
  change24h: number;
}

export interface Portfolio {
  fiat: string;
  totalUsd: number;
  totalFiat: number;
  assets: PortfolioAsset[];
}

/** Build the full portfolio valued in the user's display fiat. */
export async function buildPortfolio(
  balances: { symbol: string; kind: string; amount: Prisma.Decimal | number }[],
  displayFiat: string,
): Promise<Portfolio> {
  const prices = await getPrices();
  const { getFiatRates } = await import("./prices");
  const FIAT_USD_RATE = await getFiatRates();
  const fiatRate = FIAT_USD_RATE[displayFiat] ?? 1;

  const assets: PortfolioAsset[] = [];
  let totalUsd = 0;

  for (const b of balances) {
    const amount = Number(b.amount);
    if (amount <= 0 && b.symbol !== "USDT" && b.symbol !== displayFiat) {
      // still include primary rails even at zero, skip dust of others
    }
    const isFiat = kindOf(b.symbol) === "fiat";
    let usdValue: number;
    let change24h = 0;
    if (isFiat) {
      usdValue = amount * (FIAT_USD_RATE[b.symbol] ?? 1);
    } else {
      const p = prices[b.symbol];
      usdValue = amount * (p?.usd ?? 0);
      change24h = p?.change24h ?? 0;
    }
    totalUsd += usdValue;

    const meta = isFiat ? FIAT_BY_CODE[b.symbol] : CRYPTO_BY_SYMBOL[b.symbol];
    assets.push({
      symbol: b.symbol,
      kind: isFiat ? "fiat" : "crypto",
      name: isFiat ? FIAT_BY_CODE[b.symbol]?.name ?? b.symbol : CRYPTO_BY_SYMBOL[b.symbol]?.name ?? b.symbol,
      color: isFiat ? "#2AC8FF" : CRYPTO_BY_SYMBOL[b.symbol]?.color ?? "#2AC8FF",
      glyph: isFiat ? FIAT_BY_CODE[b.symbol]?.flag ?? "" : CRYPTO_BY_SYMBOL[b.symbol]?.glyph ?? "",
      amount,
      usdValue,
      fiatValue: usdValue / fiatRate,
      change24h,
    });
    void meta;
  }

  // Sort by value desc, keep crypto rails prominent
  assets.sort((a, b) => b.usdValue - a.usdValue);

  return {
    fiat: displayFiat,
    totalUsd,
    totalFiat: totalUsd / fiatRate,
    assets,
  };
}

export { toUsd };
