import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listDeposits } from "@/lib/settlement/dextopus";
import { parseDextopusDeposit } from "@/lib/settlement/webhook";
import { scaleDepositAmount } from "@/lib/settlement/deposit-amount";
import { resolveDepositAsset } from "@/lib/settlement/asset-resolve";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * What Dextopus ACTUALLY sends, and what we make of it. READ ONLY.
 *
 * This should have been the first thing built. Every fix so far was reasoned
 * from our own code with the provider's payload guessed at, which is why each
 * one was correct about something and none of them ended the problem. This
 * asks Dextopus directly and shows the raw record next to every step of our
 * own processing, so a wrong assumption is visible instead of inferred.
 *
 * It writes nothing and credits nothing.
 */

async function isAdmin(userId: string): Promise<boolean> {
  const admins = (process.env.ADMIN_EMAILS ?? process.env.ADMIN_MAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!admins.length) return false;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return !!user?.email && admins.includes(user.email.toLowerCase());
}

export async function GET(req: Request) {
  const me = await getUserId();
  if (!me || !(await isAdmin(me))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();

  const user = q
    ? await prisma.user.findFirst({
        where: { OR: [{ id: q }, { email: q }, { username: q.replace(/^@/, "") }] },
        select: { id: true, username: true },
      })
    : await prisma.user.findUnique({ where: { id: me }, select: { id: true, username: true } });

  if (!user) return NextResponse.json({ error: `No user matched "${q}"` }, { status: 404 });

  const addresses = await prisma.walletAddress.findMany({
    where: { userId: user.id, provider: "dextopus" },
    select: { address: true, symbol: true, network: true },
  });

  const records = await listDeposits({ userId: user.id }).catch((e) => {
    return [{ __error: (e as Error).message }] as Record<string, unknown>[];
  });

  // Walk each record through our own pipeline and report every step.
  const analysed = [];
  for (const record of records.slice(0, 10)) {
    const step: Record<string, unknown> = { raw: record };
    try {
      const parsed = parseDextopusDeposit({ data: record });
      step.parsed = {
        externalId: parsed.externalId,
        asset: parsed.asset,
        amount: parsed.amount,
        amountIsRaw: parsed.amountIsRaw,
        rawAmount: parsed.rawAmount,
        chain: parsed.chain,
        chainId: parsed.chainId,
        status: parsed.status,
        settled: parsed.settled,
        address: parsed.address,
        userId: parsed.userId,
      };
      step.resolvesToTicker = await resolveDepositAsset(parsed.asset, parsed.chainId).catch(() => null);
      const scaled = await scaleDepositAmount(parsed);
      step.scaledAmount = scaled.deposit ? scaled.deposit.amount : null;
      step.scaleProblem = scaled.reason ?? null;
      step.alreadyRecorded = !!(await prisma.settlement.findUnique({
        where: { externalId: parsed.externalId },
        select: { id: true },
      }));
      step.addressMatchesAUser = !!(await prisma.walletAddress.findFirst({
        where: { address: parsed.address },
        select: { id: true },
      }));
    } catch (e) {
      step.parseError = (e as Error).message;
    }
    analysed.push(step);
  }

  return NextResponse.json({
    user: user.username ?? user.id,
    ourAddresses: addresses,
    dextopusReturned: records.length,
    settlementAssetEnv: process.env.DEXTOPUS_SETTLEMENT_ASSET ?? null,
    deposits: analysed,
    readThis:
      records.length === 0
        ? "Dextopus has NO deposits for this user. Either the deposit went to an address minted under a different userId, or their API isn't returning it. That is a provider-side question."
        : "Each entry shows the provider's raw record and every step of our processing. The first step whose output looks wrong is the bug.",
  });
}
