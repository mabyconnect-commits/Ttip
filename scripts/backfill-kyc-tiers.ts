/**
 * Re-tier existing accounts onto the new KYC ladder.
 *
 * DRY RUN BY DEFAULT — pass --apply to write.
 *
 * Accounts verified before this change were all granted Tier 2 (the old code
 * did `Math.max(2, result.tier)`), regardless of what they actually proved, and
 * carry no record of which documents were checked. This reconstructs that
 * record from what we do know — a stored `bvnHash` means the BVN was verified —
 * and recomputes the tier from it.
 *
 * Most accounts will move 2 -> 1. That is the intended correction, not a
 * regression: a BVN alone is Tier 1 on the new ladder, and those accounts were
 * holding a ₦5,000,000 daily limit they had never earned. Anyone who has also
 * verified a government ID moves back up as soon as they submit it.
 *
 * Usage:
 *   npm run backfill:kyc-tiers            # dry run
 *   npm run backfill:kyc-tiers -- --apply
 */
import { PrismaClient } from "@prisma/client";
import { tierFor } from "../src/lib/kyc/tier";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

async function main() {
  const users = await prisma.user.findMany({
    where: { kycStatus: "verified" },
    select: { id: true, email: true, username: true, kycTier: true, kycIdTypes: true, bvnHash: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`\n  KYC RE-TIER ${apply ? "— APPLYING" : "— DRY RUN (nothing will change)"}\n`);

  let changed = 0;
  for (const u of users) {
    // Already has a document record — leave it alone, it's authoritative.
    if (u.kycIdTypes.length > 0) continue;

    // A stored BVN hash is proof the BVN was verified. Without one we can't
    // evidence anything, so the account drops to 0 and must re-verify.
    const idTypes = u.bvnHash ? ["bvn"] : [];
    const tier = tierFor(idTypes);
    if (tier === u.kycTier && idTypes.length === 0) continue;

    console.log(`  ${u.username} <${u.email}>  tier ${u.kycTier} -> ${tier}  [${idTypes.join(", ") || "no evidence"}]`);
    changed++;

    if (apply) {
      await prisma.user.update({
        where: { id: u.id },
        data: {
          kycIdTypes: idTypes,
          kycTier: tier,
          // No evidence at all means the account can't stay "verified".
          ...(idTypes.length === 0 ? { kycStatus: "unverified" } : {}),
        },
      });
    }
  }

  console.log("\n  " + "=".repeat(70));
  console.log(`  ${users.length} verified account(s), ${changed} re-tiered.`);
  if (!apply) console.log("  DRY RUN — nothing was changed. Re-run with --apply.");
  console.log("  " + "=".repeat(70) + "\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
