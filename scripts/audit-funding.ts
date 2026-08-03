/**
 * Funding audit — READ ONLY. Never writes anything.
 *
 * Answers: which accounts hold value they never actually paid for?
 *
 * Value can only legitimately enter a user's balance two ways:
 *   1. a real crypto deposit swept by the deposit provider (Settlement
 *      kind=deposit, provider != "sandbox"), or
 *   2. a real fiat collection (Settlement kind=buy/deposit, provider =
 *      flutterwave / paystack / monnify / coralpay).
 *
 * Everything else that ever credited a balance is UNFUNDED:
 *   - the deposit simulator (Settlement provider="sandbox", externalId "sim_…")
 *   - sandbox buys, which credit crypto without taking payment
 *   - the fiat branch of the simulator, which writes a "deposit" transaction
 *     and NO settlement row at all
 *   - demo balances handed out by prisma/seed.ts (no provenance whatsoever)
 *
 * Platform promos (signup/deposit bonus, referral, cashback) are reported
 * separately: they're unfunded too, but they're deliberate marketing spend, not
 * someone gaming the simulator.
 *
 * Usage:
 *   npm run audit:funding              # every account
 *   npm run audit:funding -- --json    # machine-readable
 *   npm run audit:funding -- --user=someone@example.com
 */
import { PrismaClient } from "@prisma/client";
import { toUsd } from "../src/lib/prices";

const prisma = new PrismaClient();

/** Providers that mean real money actually arrived. */
const REAL_PROVIDERS = new Set(["dextopus", "flutterwave", "paystack", "monnify", "coralpay"]);
/** Transaction types that are platform promos rather than user funding. */
const GRANT_TYPES = new Set(["deposit_bonus", "referral_bonus", "referral_withdraw", "cashback"]);

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const userFilter = args.find((a) => a.startsWith("--user="))?.split("=")[1];

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Row {
  userId: string;
  email: string;
  username: string;
  createdAt: string;
  realFundedUsd: number;
  simulatedUsd: number;
  grantsUsd: number;
  seededDemo: boolean;
  unfundedUsd: number;
  holdingsUsd: number;
  withdrawnUsd: number;
  /** Unfunded value still on the platform — recoverable by debiting. */
  recoverableUsd: number;
  /** Unfunded value that already left the platform — a realised loss. */
  realisedLossUsd: number;
  detail: string[];
}

async function main() {
  const users = await prisma.user.findMany({
    where: userFilter ? { OR: [{ email: userFilter }, { username: userFilter }, { id: userFilter }] } : undefined,
    include: { balances: true, card: true },
    orderBy: { createdAt: "asc" },
  });

  if (!users.length) {
    console.log(userFilter ? `No account matched "${userFilter}".` : "No accounts found.");
    return;
  }

  const rows: Row[] = [];

  for (const u of users) {
    const detail: string[] = [];

    // ---- Inflows with provenance (settlements) ----
    const settlements = await prisma.settlement.findMany({
      where: { userId: u.id, status: "completed", kind: { in: ["deposit", "buy"] } },
    });

    let realFundedUsd = 0;
    let simulatedUsd = 0;
    for (const s of settlements) {
      const usd = await toUsd(Number(s.amount), s.asset);
      if (REAL_PROVIDERS.has(s.provider)) {
        realFundedUsd += usd;
      } else {
        simulatedUsd += usd;
        detail.push(`sim ${s.kind} ${s.amount} ${s.asset} via ${s.provider} (${s.externalId})`);
      }
    }

    // ---- Inflows with NO provenance ----
    // The simulator's fiat branch credits a balance and writes only a
    // transaction, so it leaves no settlement to match against.
    const txns = await prisma.transaction.findMany({ where: { userId: u.id } });
    const settlementRefs = new Set(
      settlements.map((s) => s.reference ?? "").filter(Boolean),
    );

    let grantsUsd = 0;
    for (const t of txns) {
      if (GRANT_TYPES.has(t.type)) {
        grantsUsd += await toUsd(Number(t.amountOut ?? 0), t.assetOut ?? "NGN");
        continue;
      }
      if (t.type !== "deposit" || t.status !== "completed") continue;
      const ref = (t.meta as { reference?: string } | null)?.reference;
      if (ref && settlementRefs.has(ref)) continue; // already counted above
      // A "deposit" transaction with no settlement behind it can only have come
      // from the simulator's fiat branch.
      if (t.counterparty === "Bank transfer") {
        const usd = await toUsd(Number(t.amountOut ?? 0), t.assetOut ?? "NGN");
        simulatedUsd += usd;
        detail.push(`sim fiat deposit ${t.amountOut} ${t.assetOut} (no settlement row)`);
      }
    }

    // ---- What they hold now, and what already left ----
    let holdingsUsd = 0;
    for (const b of u.balances) holdingsUsd += await toUsd(Number(b.amount), b.symbol);
    if (u.card) holdingsUsd += Number(u.card.balanceUsd);

    // ---- Balances handed out by the demo seed ----
    // Seeded accounts hold value with no deposit of any kind behind it. Promos
    // also credit a balance without a deposit, so only the part of the holdings
    // that grants DON'T explain counts as unfunded — otherwise a user whose only
    // balance is their ₦500 signup bonus would be flagged as a thief.
    const noDepositHistory = settlements.length === 0 && !txns.some((t) => t.type === "deposit");
    const unexplainedUsd = noDepositHistory ? Math.max(0, holdingsUsd - grantsUsd) : 0;
    const seededDemo = unexplainedUsd > 0.01;
    if (seededDemo) {
      detail.push(
        `$${money(unexplainedUsd)} held with no deposit history and no promo behind it ` +
          `(demo seed or manual DB edit)`,
      );
    }

    let withdrawnUsd = 0;
    for (const t of txns) {
      if (t.status !== "completed") continue;
      if (t.type === "withdraw_bank" || t.type === "withdraw_wallet" || t.type === "bill" || t.type === "card_spend") {
        withdrawnUsd += await toUsd(Number(t.amountIn ?? 0), t.assetIn ?? "USDT");
      }
    }

    // Anything a clawback run already reversed is no longer outstanding.
    let reversedUsd = 0;
    for (const t of txns) {
      if (t.type !== "adjustment") continue;
      if ((t.meta as { reason?: string } | null)?.reason !== "unfunded_credit_reversal") continue;
      reversedUsd += await toUsd(Number(t.amountIn ?? 0), t.assetIn ?? "USDT");
    }
    if (reversedUsd > 0) detail.push(`$${money(reversedUsd)} already reversed by a previous clawback`);

    // Unfunded credit = simulated inflows + value with no provenance at all,
    // less whatever has already been clawed back.
    const unfunded = Math.max(0, simulatedUsd + unexplainedUsd - reversedUsd);
    const recoverableUsd = Math.max(0, Math.min(unfunded, holdingsUsd));
    // Value that left the platform beyond what they actually paid in is gone —
    // debiting a balance cannot get it back.
    const realisedLossUsd = Math.max(0, Math.min(unfunded, withdrawnUsd - realFundedUsd));

    rows.push({
      userId: u.id,
      email: u.email,
      username: u.username,
      createdAt: u.createdAt.toISOString().slice(0, 10),
      realFundedUsd,
      simulatedUsd,
      grantsUsd,
      seededDemo,
      unfundedUsd: unfunded,
      holdingsUsd,
      withdrawnUsd,
      recoverableUsd,
      realisedLossUsd,
      detail,
    });
  }

  if (asJson) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  const flagged = rows.filter((r) => r.unfundedUsd > 0.01);
  const clean = rows.length - flagged.length;

  console.log(`\n  FUNDING AUDIT — ${rows.length} account(s), ${flagged.length} flagged, ${clean} clean\n`);

  if (flagged.length) {
    console.log("  UNFUNDED ACCOUNTS");
    console.log("  " + "-".repeat(96));
    for (const r of flagged) {
      console.log(`  ${r.username} <${r.email}>  joined ${r.createdAt}`);
      console.log(
        `     real funded $${money(r.realFundedUsd)}  |  unfunded $${money(r.unfundedUsd)}` +
          `  |  holds $${money(r.holdingsUsd)}  |  withdrawn $${money(r.withdrawnUsd)}`,
      );
      console.log(
        `     RECOVERABLE (debit) $${money(r.recoverableUsd)}` +
          (r.realisedLossUsd > 0 ? `   ⚠ ALREADY GONE $${money(r.realisedLossUsd)}` : ""),
      );
      for (const d of r.detail.slice(0, 6)) console.log(`       · ${d}`);
      if (r.detail.length > 6) console.log(`       · …and ${r.detail.length - 6} more`);
      console.log("");
    }
  }

  const totalRecoverable = rows.reduce((a, r) => a + r.recoverableUsd, 0);
  const totalLost = rows.reduce((a, r) => a + r.realisedLossUsd, 0);
  const totalGrants = rows.reduce((a, r) => a + r.grantsUsd, 0);

  console.log("  " + "=".repeat(96));
  console.log(`  Recoverable by debiting balances : $${money(totalRecoverable)}`);
  console.log(`  Already withdrawn (REAL LOSS)    : $${money(totalLost)}${totalLost > 0 ? "   ← investigate these first" : ""}`);
  console.log(`  Platform promos (bonuses etc.)   : $${money(totalGrants)}   (intentional spend, not counted above)`);
  console.log("  " + "=".repeat(96));
  console.log(`\n  Nothing was modified. To claw back the recoverable amount:`);
  console.log(`    npm run clawback            # dry run, shows the exact debits`);
  console.log(`    npm run clawback -- --apply # actually debit\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
