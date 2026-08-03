/**
 * Claw back balances that were never actually funded.
 *
 * DRY RUN BY DEFAULT — it prints the exact debits and changes nothing unless
 * you pass --apply. Run `npm run audit:funding` first to see the full picture.
 *
 * What it debits, per user and per asset:
 *   min(unfunded amount of that asset, current balance of that asset)
 *
 * Deliberate limits, so this can't do damage of its own:
 *   - it never takes a balance below zero;
 *   - it only ever debits the specific assets that were simulated;
 *   - it leaves platform promos (signup/deposit bonus, referral, cashback)
 *     alone — those are real liabilities the business chose to grant;
 *   - where the fake funds were already spent or withdrawn, it debits what's
 *     left and reports the shortfall rather than pushing the account negative.
 *     A shortfall is money that has genuinely left the platform; no ledger edit
 *     recovers it, so it needs a human decision.
 *   - every debit writes an `adjustment` transaction, so the user and you can
 *     both see what happened and why.
 *
 * Usage:
 *   npm run clawback                          # dry run, all accounts
 *   npm run clawback -- --user=a@b.com        # dry run, one account
 *   npm run clawback -- --apply               # execute
 */
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

const REAL_PROVIDERS = new Set(["dextopus", "flutterwave", "paystack", "monnify", "coralpay"]);
/** Platform promos — unfunded, but deliberate spend. Never clawed back. */
const GRANT_TYPES = ["deposit_bonus", "referral_bonus", "referral_withdraw", "cashback"];

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const userFilter = args.find((a) => a.startsWith("--user="))?.split("=")[1];

const NOTE = "Reversal of unfunded (test) credit";

async function main() {
  const users = await prisma.user.findMany({
    where: userFilter ? { OR: [{ email: userFilter }, { username: userFilter }, { id: userFilter }] } : undefined,
    include: { balances: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`\n  CLAWBACK ${apply ? "— APPLYING" : "— DRY RUN (nothing will change)"}\n`);

  let totalDebits = 0;
  let totalShortfalls = 0;

  for (const u of users) {
    // Unfunded credit per asset, from settlements that no real provider backed.
    const unfundedByAsset = new Map<string, number>();

    const settlements = await prisma.settlement.findMany({
      where: { userId: u.id, status: "completed", kind: { in: ["deposit", "buy"] } },
    });
    for (const s of settlements) {
      if (REAL_PROVIDERS.has(s.provider)) continue;
      unfundedByAsset.set(s.asset, (unfundedByAsset.get(s.asset) ?? 0) + Number(s.amount));
    }

    // The simulator's fiat branch leaves no settlement — match its transactions.
    const fiatSims = await prisma.transaction.findMany({
      where: { userId: u.id, type: "deposit", status: "completed", counterparty: "Bank transfer" },
    });
    for (const t of fiatSims) {
      const asset = t.assetOut ?? "NGN";
      unfundedByAsset.set(asset, (unfundedByAsset.get(asset) ?? 0) + Number(t.amountOut ?? 0));
    }

    // Balances with no deposit provenance at all (demo seed / manual edits).
    // Promos credit a balance without any deposit too, so subtract what the
    // user was legitimately granted before treating the rest as unfunded —
    // a signup bonus is a real liability, not something to claw back.
    const anyDeposit = settlements.length > 0 || fiatSims.length > 0;
    if (!anyDeposit) {
      const grants = await prisma.transaction.findMany({
        where: { userId: u.id, status: "completed", type: { in: [...GRANT_TYPES] } },
      });
      const grantedByAsset = new Map<string, number>();
      for (const g of grants) {
        const asset = g.assetOut ?? "NGN";
        grantedByAsset.set(asset, (grantedByAsset.get(asset) ?? 0) + Number(g.amountOut ?? 0));
      }
      for (const b of u.balances) {
        const held = Number(b.amount);
        if (!(held > 0)) continue;
        const unexplained = held - (grantedByAsset.get(b.symbol) ?? 0);
        if (unexplained > 0) unfundedByAsset.set(b.symbol, unexplained);
      }
    }

    // Subtract what a previous run already reversed. Without this the script
    // recomputes the same unfunded total every time and would debit it again on
    // a second run — running it twice must be a no-op, not a double charge.
    const priorReversals = await prisma.transaction.findMany({
      where: {
        userId: u.id,
        type: "adjustment",
        meta: { path: ["reason"], equals: "unfunded_credit_reversal" },
      },
    });
    for (const r of priorReversals) {
      const asset = r.assetIn ?? "";
      if (!unfundedByAsset.has(asset)) continue;
      const left = (unfundedByAsset.get(asset) ?? 0) - Number(r.amountIn ?? 0);
      if (left > 1e-9) unfundedByAsset.set(asset, left);
      else unfundedByAsset.delete(asset);
    }

    if (!unfundedByAsset.size) continue;

    const debits: { symbol: string; debit: number; shortfall: number }[] = [];
    for (const [symbol, unfunded] of unfundedByAsset) {
      const bal = Number(u.balances.find((b) => b.symbol === symbol)?.amount ?? 0);
      const debit = Math.min(unfunded, bal);
      const shortfall = Math.max(0, unfunded - bal);
      if (debit > 0 || shortfall > 0) debits.push({ symbol, debit, shortfall });
    }
    if (!debits.length) continue;

    console.log(`  ${u.username} <${u.email}>`);
    for (const d of debits) {
      const parts = [`debit ${d.debit} ${d.symbol}`];
      if (d.shortfall > 0) parts.push(`SHORTFALL ${d.shortfall} ${d.symbol} — already spent/withdrawn`);
      console.log(`     · ${parts.join("   |   ")}`);
      totalDebits += d.debit > 0 ? 1 : 0;
      totalShortfalls += d.shortfall > 0 ? 1 : 0;
    }

    if (apply) {
      await prisma.$transaction(async (tx) => {
        for (const d of debits) {
          if (!(d.debit > 0)) continue;
          await tx.balance.update({
            where: { userId_symbol: { userId: u.id, symbol: d.symbol } },
            data: { amount: { decrement: d.debit } },
          });
          await tx.transaction.create({
            data: {
              userId: u.id,
              type: "adjustment",
              status: "completed",
              assetIn: d.symbol,
              amountIn: new Prisma.Decimal(d.debit),
              counterparty: "Ttip",
              note: NOTE,
              emoji: "⚖️",
              meta: {
                reason: "unfunded_credit_reversal",
                shortfall: d.shortfall,
                appliedAt: new Date().toISOString(),
              } as Prisma.InputJsonValue,
            },
          });
        }
      });
      console.log("     ✔ applied");
    }
    console.log("");
  }

  console.log("  " + "=".repeat(80));
  console.log(`  ${totalDebits} debit(s), ${totalShortfalls} shortfall(s).`);
  if (!apply) console.log("  DRY RUN — nothing was changed. Re-run with --apply to execute.");
  else console.log("  Applied. Re-run `npm run audit:funding` to confirm.");
  console.log("  " + "=".repeat(80) + "\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
