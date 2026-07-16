import { z } from "zod";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized } from "@/lib/api";
import { getAppState } from "@/lib/serialize";
import { timeAgo } from "@/lib/format";
import { FIAT_BY_CODE } from "@/lib/constants";
import { baseUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

export async function GET() {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return unauthorized();

    const friends = await prisma.user.count({ where: { id: { not: userId } } });
    const tippers = await prisma.transaction.findMany({
      where: { userId, type: "ttip_in" },
      orderBy: { createdAt: "desc" },
      take: 6,
    });

    const base = baseUrl();
    return ok({
      link: `${base.replace(/^https?:\/\//, "")}/u/${user.username}`.replace(/\/$/, ""),
      fullLink: `${base}/u/${user.username}`,
      friends: friends + 200,
      recentTippers: tippers.map((t) => ({
        handle: t.counterparty ?? "",
        note: t.note,
        amount: t.amountOut ? Number(t.amountOut) : 0,
        currency: t.assetOut,
        symbol: FIAT_BY_CODE[t.assetOut ?? ""]?.symbol ?? "",
        time: timeAgo(t.createdAt),
      })),
    });
  });
}

const patch = z.object({
  defaultFiat: z.string().optional(),
  name: z.string().min(1).max(60).optional(),
  bankName: z.string().max(80).optional(),
  bankAccount: z.string().max(20).optional(),
});

export async function PATCH(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const input = patch.parse(await req.json());
    await prisma.user.update({
      where: { id: userId },
      data: {
        defaultFiat: input.defaultFiat && FIAT_BY_CODE[input.defaultFiat] ? input.defaultFiat : undefined,
        name: input.name,
        bankName: input.bankName,
        bankAccount: input.bankName && input.bankAccount ? `${input.bankName} ••${input.bankAccount.slice(-4)}` : undefined,
      },
    });
    const state = await getAppState(userId);
    return ok(state);
  });
}
