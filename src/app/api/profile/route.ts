import { z } from "zod";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized } from "@/lib/api";
import { getAppState } from "@/lib/serialize";
import { timeAgo } from "@/lib/format";
import { FIAT_BY_CODE } from "@/lib/constants";
import { payoutCurrencySupported } from "@/lib/settlement/payout-country";
import { baseUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

export async function GET() {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return unauthorized();

    // Verified friends only, and a real number. This used to count every row in
    // the users table and then add a flat 200 — a figure shown to users that was
    // simply invented. A verified count is the one that means something anyway:
    // those are the people who can actually send and receive.
    const friends = await prisma.user.count({
      where: { id: { not: userId }, kycStatus: "verified" },
    });
    const tippers = await prisma.transaction.findMany({
      where: { userId, type: "ttip_in" },
      orderBy: { createdAt: "desc" },
      take: 6,
    });

    const base = baseUrl();
    return ok({
      link: `${base.replace(/^https?:\/\//, "")}/u/${user.username}`.replace(/\/$/, ""),
      fullLink: `${base}/u/${user.username}`,
      friends,
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
        // Only currencies we can actually pay out in. The display currency is
        // also the payout currency here, so letting someone switch to one we
        // can't settle would strand their balance.
        defaultFiat:
          input.defaultFiat && FIAT_BY_CODE[input.defaultFiat] && payoutCurrencySupported(input.defaultFiat)
            ? input.defaultFiat
            : undefined,
        name: input.name,
        bankName: input.bankName,
        bankAccount: input.bankName && input.bankAccount ? `${input.bankName} ••${input.bankAccount.slice(-4)}` : undefined,
      },
    });
    const state = await getAppState(userId);
    return ok(state);
  });
}
