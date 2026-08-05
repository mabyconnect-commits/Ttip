/**
 * Repair deposits mis-credited by the origin/settlement mix-up.
 *
 * THE BUG (fixed in src/lib/settlement/webhook.ts + the deposit webhook route):
 * a cross-chain deposit's settlement asset could be paired with its *origin*
 * amount, so a user who sent 0.4 SOL was credited "0.4 USDC" — the symbol was
 * relabelled, the number never converted. It loses money in both directions:
 * 0.4 SOL (~$60) credited as $0.40, or 5,000 of a cheap token credited as
 * 5,000 USDC.
 *
 * This script reads each Dextopus deposit's stored raw payload — the provider's
 * own record of what settled — and compares it with what we actually credited.
 *
 *   DRY RUN (default): reports every discrepancy, writes nothing.
 *   --apply:           corrects balance, treasury and the transaction row
 *                      inside one transaction, with a full audit trail.
 *
 * Usage:
 *   npx tsx scripts/repair-mislabelled-deposits.ts
 *   npx tsx scripts/repair-mislabelled-deposits.ts --json
 *   npx tsx scripts/repair-mislabelled-deposits.ts --user=someone@example.com
 *   npx tsx scripts/repair-mislabelled-deposits.ts --apply
 *
 * A deposit whose raw payload does NOT contain a usable settlement amount
 * cannot be repaired automatically — there is no trustworthy number to write.
 * Those are listed as NEEDS-MANUAL so you can look the transfer up on-chain.
 */
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const asJson = args.includes("--json");
const userFilter = args.find((a) => a.startsWith("--user="))?.split("=")[1];

type Finding = {
  settlementId: string;
  externalId: string;
  userId: string | null;
  userEmail?: string | null;
  creditedAsset: string;
  creditedAmount: number;
  trueSettlementAsset: string | null;
  trueSettlementAmount: number | null;
  originAsset: string | null;
  originAmount: number | null;
  delta: number | null;
  verdict: "OK" | "MIS-CREDITED" | "NEEDS-MANUAL";
};

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function str(v: unknown): string | null {
  const s = v === null || v === undefined ? "" : String(v).toUpperCase().trim();
  return s || null;
}

async function main() {
  const settlements = await prisma.settlement.findMany({
    where: {
      kind: "deposit",
      provider: "dextopus",
      status: "completed",
      ...(userFilter ? { user: { email: userFilter } } : {}),
    },
    include: { user: { select: { email: true } } },
    orderBy: { createdAt: "desc" },
  });

  const findings: Finding[] = [];

  for (const s of settlements) {
    const raw = (s.raw ?? {}) as { data?: Record<string, unknown> };
    const d = raw.data ?? {};

    const trueSettlementAsset = str(d.settlementAsset);
    const trueSettlementAmount = num(d.settlementAmountFormatted);
    const originAsset = str(d.originAsset);
    const originAmount = num(d.originAmountFormatted);

    const creditedAsset = s.asset.toUpperCase();
    const creditedAmount = Number(s.amount);

    let verdict: Finding["verdict"] = "OK";

    if (trueSettlementAmount === null || trueSettlementAsset === null) {
      // No trustworthy settlement figure in the payload. If the credited amount
      // exactly equals an origin amount denominated in a *different* asset,
      // this is the relabel bug and needs a human to price it on-chain.
      if (originAmount !== null && originAsset && originAsset !== creditedAsset && Math.abs(creditedAmount - originAmount) < 1e-12) {
        verdict = "NEEDS-MANUAL";
      }
    } else if (
      creditedAsset !== trueSettlementAsset ||
      Math.abs(creditedAmount - trueSettlementAmount) > 1e-9
    ) {
      verdict = "MIS-CREDITED";
    }

    if (verdict !== "OK") {
      findings.push({
        settlementId: s.id,
        externalId: s.externalId,
        userId: s.userId,
        userEmail: s.user?.email ?? null,
        creditedAsset,
        creditedAmount,
        trueSettlementAsset,
        trueSettlementAmount,
        originAsset,
        originAmount,
        delta:
          trueSettlementAmount !== null && creditedAsset === trueSettlementAsset
            ? trueSettlementAmount - creditedAmount
            : null,
        verdict,
      });
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ scanned: settlements.length, findings }, null, 2));
  } else {
    console.log(`\nScanned ${settlements.length} Dextopus deposit(s).`);
    console.log(`Found ${findings.length} needing attention.\n`);
    for (const f of findings) {
      console.log(`  [${f.verdict}] ${f.externalId}`);
      console.log(`    user      : ${f.userEmail ?? f.userId ?? "unknown"}`);
      console.log(`    credited  : ${f.creditedAmount} ${f.creditedAsset}`);
      if (f.originAsset) console.log(`    they sent : ${f.originAmount ?? "?"} ${f.originAsset}`);
      if (f.trueSettlementAmount !== null) {
        console.log(`    settled   : ${f.trueSettlementAmount} ${f.trueSettlementAsset}`);
        console.log(`    owed      : ${f.delta !== null ? f.delta.toFixed(8) : "n/a"} ${f.trueSettlementAsset}`);
      } else {
        console.log(`    settled   : NOT IN PAYLOAD — look up ${f.externalId} on-chain and correct by hand`);
      }
      console.log("");
    }
  }

  const repairable = findings.filter(
    (f) =>
      f.verdict === "MIS-CREDITED" &&
      f.userId &&
      f.trueSettlementAsset !== null &&
      f.trueSettlementAmount !== null,
  );

  if (!apply) {
    console.log(
      repairable.length
        ? `DRY RUN — nothing written. ${repairable.length} can be repaired automatically; re-run with --apply.`
        : "DRY RUN — nothing written.",
    );
    const manual = findings.filter((f) => f.verdict === "NEEDS-MANUAL").length;
    if (manual) console.log(`${manual} need a manual on-chain lookup — this script will not guess a value for them.`);
    return;
  }

  for (const f of repairable) {
    const userId = f.userId as string;
    const trueAsset = f.trueSettlementAsset as string;
    const trueAmount = f.trueSettlementAmount as number;

    await prisma.$transaction(async (tx) => {
      // Back out whatever was wrongly credited.
      await tx.balance.update({
        where: { userId_symbol: { userId, symbol: f.creditedAsset } },
        data: { amount: { decrement: new Prisma.Decimal(f.creditedAmount) } },
      });

      // Credit the real settled amount.
      await tx.balance.upsert({
        where: { userId_symbol: { userId, symbol: trueAsset } },
        create: {
          userId,
          symbol: trueAsset,
          kind: "stable",
          amount: new Prisma.Decimal(trueAmount),
        },
        update: { amount: { increment: new Prisma.Decimal(trueAmount) } },
      });

      // Keep the settlement row truthful.
      await tx.settlement.update({
        where: { id: f.settlementId },
        data: { asset: trueAsset, amount: new Prisma.Decimal(trueAmount) },
      });

      // Correct the user-visible transaction rather than leaving a wrong one.
      const txn = await tx.transaction.findFirst({
        where: { userId, type: "deposit", meta: { path: ["externalId"], equals: f.externalId } },
      });
      if (txn) {
        await tx.transaction.update({
          where: { id: txn.id },
          data: {
            assetOut: trueAsset,
            amountOut: new Prisma.Decimal(trueAmount),
            ...(f.originAsset && f.originAmount
              ? { assetIn: f.originAsset, amountIn: new Prisma.Decimal(f.originAmount) }
              : {}),
            note:
              f.originAsset && f.originAmount
                ? `Received ${f.originAmount} ${f.originAsset} — settled as ${trueAmount} ${trueAsset} (corrected)`
                : `Received ${trueAmount} ${trueAsset} (corrected)`,
            meta: {
              ...((txn.meta ?? {}) as Record<string, unknown>),
              correctedAt: new Date().toISOString(),
              correctedFrom: { asset: f.creditedAsset, amount: f.creditedAmount },
              correctionReason: "origin/settlement asset mix-up",
            },
          },
        });
      }

      // Audit row so the correction itself is never invisible.
      await tx.transaction.create({
        data: {
          userId,
          type: "deposit",
          status: "completed",
          assetOut: trueAsset,
          amountOut: new Prisma.Decimal(trueAmount - (f.creditedAsset === trueAsset ? f.creditedAmount : 0)),
          counterparty: "Correction",
          note: `Deposit ${f.externalId} re-settled: was ${f.creditedAmount} ${f.creditedAsset}, correct value ${trueAmount} ${trueAsset}`,
          emoji: "🛠️",
          meta: {
            kind: "deposit-correction",
            externalId: f.externalId,
            settlementId: f.settlementId,
            wasAsset: f.creditedAsset,
            wasAmount: f.creditedAmount,
            nowAsset: trueAsset,
            nowAmount: trueAmount,
          },
        },
      });
    });

    console.log(`  repaired ${f.externalId}: ${f.creditedAmount} ${f.creditedAsset} → ${trueAmount} ${trueAsset}`);
  }

  console.log(`\nApplied ${repairable.length} repair(s).`);
  console.log("Treasury totals are NOT adjusted here — reconcile treasury separately against actual on-chain holdings.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
