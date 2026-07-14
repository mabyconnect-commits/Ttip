import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized, ApiError } from "@/lib/api";
import { getAppState } from "@/lib/serialize";
import { CRYPTO_ASSETS } from "@/lib/constants";

export const dynamic = "force-dynamic";

// List deposit addresses grouped by asset.
export async function GET() {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const addresses = await prisma.walletAddress.findMany({ where: { userId } });

    const bySymbol: Record<string, { network: string; address: string }[]> = {};
    for (const a of addresses) {
      (bySymbol[a.symbol] ??= []).push({ network: a.network, address: a.address });
    }
    const assets = CRYPTO_ASSETS.filter((a) => bySymbol[a.symbol]).map((a) => ({
      symbol: a.symbol,
      name: a.name,
      color: a.color,
      glyph: a.glyph,
      networks: bySymbol[a.symbol],
    }));
    return ok({ assets });
  });
}

const simSchema = z.object({
  symbol: z.string(),
  amount: z.number().positive(),
  network: z.string().optional(),
});

// Simulate an incoming on-chain deposit (demo / testnet helper).
export async function POST(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const { symbol, amount, network } = simSchema.parse(await req.json());
    if (!CRYPTO_ASSETS.find((a) => a.symbol === symbol)) throw new ApiError("Unsupported asset", 400);

    await prisma.$transaction(async (tx) => {
      await tx.balance.upsert({
        where: { userId_symbol: { userId, symbol } },
        create: { userId, symbol, kind: "crypto", amount: new Prisma.Decimal(amount) },
        update: { amount: { increment: amount } },
      });
      await tx.transaction.create({
        data: {
          userId,
          type: "deposit",
          assetOut: symbol,
          amountOut: new Prisma.Decimal(amount),
          counterparty: "On-chain",
          note: `Received ${symbol}${network ? " · " + network : ""}`,
          emoji: "📥",
        },
      });
    });

    const state = await getAppState(userId);
    return ok({ ...state, receipt: { kind: "deposit", symbol, amount, network } });
  });
}
