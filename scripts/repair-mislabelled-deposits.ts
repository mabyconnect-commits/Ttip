/**
 * Report deposits mis-credited by the origin/settlement asset mix-up.
 *
 * THE BUG (fixed in src/lib/settlement/webhook.ts + the deposit webhook route):
 * a cross-chain deposit's settlement symbol could be paired with its *origin*
 * amount, so someone who sent 0.4 SOL was credited "0.4 USDC" — relabelled,
 * never converted. It loses money in both directions.
 *
 * READ ONLY. This script reports; it never writes.
 *
 * Corrections are made in the admin UI (Account → Admin → Deposit corrections),
 * because each one moves real balance and the rows with no settled figure in the
 * payload need a human to read the transfer off-chain first. Both surfaces share
 * the same logic in src/lib/settlement/deposit-repair.ts.
 *
 * Usage:
 *   npm run repair:deposits
 *   npm run repair:deposits -- --json
 *   npm run repair:deposits -- --user=someone@example.com
 */
import { scanMislabelledDeposits } from "../src/lib/settlement/deposit-repair";
import { prisma } from "../src/lib/db";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const email = args.find((a) => a.startsWith("--user="))?.split("=")[1];

async function main() {
  const findings = await scanMislabelledDeposits({ email });
  const outstanding = findings.filter((f) => !f.alreadyRepaired);

  if (asJson) {
    console.log(JSON.stringify({ findings }, null, 2));
    return;
  }

  if (!findings.length) {
    console.log("\nNo mis-credited deposits found.\n");
    return;
  }

  console.log(`\n${findings.length} affected deposit(s), ${outstanding.length} still outstanding.\n`);

  for (const f of findings) {
    const tag = f.alreadyRepaired ? "CORRECTED" : f.verdict;
    console.log(`  [${tag}] ${f.externalId}`);
    console.log(`    user      : ${f.userEmail ?? f.username ?? f.userId ?? "unknown"}`);
    if (f.originAsset) console.log(`    they sent : ${f.originAmount ?? "?"} ${f.originAsset}`);
    console.log(`    credited  : ${f.creditedAmount} ${f.creditedAsset}`);
    if (f.trueSettlementAmount !== null) {
      console.log(`    settled   : ${f.trueSettlementAmount} ${f.trueSettlementAsset}`);
    } else {
      console.log(`    settled   : NOT IN PAYLOAD — look up on-chain, then correct in the admin UI`);
    }
    console.log("");
  }

  console.log("Correct these in the app: Account → Admin → Deposit corrections.\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
