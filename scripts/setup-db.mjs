// Runs during the Vercel build. If a database is configured, it creates the
// tables and seeds demo data automatically. If not, it logs a clear message and
// exits successfully so the app still deploys (and shows a helpful setup error).
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

function run(cmd) {
  execSync(cmd, { stdio: "inherit" });
}

// On Vercel, env vars are already in process.env. Locally, load them from .env
// so `npm run build` also provisions the database.
if (!process.env.DATABASE_URL && existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

if (!process.env.DATABASE_URL) {
  console.warn(
    "\n[setup-db] DATABASE_URL is not set — skipping database setup.\n" +
      "[setup-db] Add a Postgres database and set DATABASE_URL in your Vercel project,\n" +
      "[setup-db] then redeploy. The app will deploy but sign-in/sign-up need the DB.\n",
  );
  process.exit(0);
}

try {
  console.log("[setup-db] Creating / updating database tables…");
  run("npx prisma db push --skip-generate --accept-data-loss");
} catch (e) {
  console.warn("[setup-db] Could not reach the database to create tables:", e?.message ?? e);
  console.warn("[setup-db] Check that DATABASE_URL is correct and the database is reachable.");
  process.exit(0); // don't fail the build; app will surface a clear runtime error
}

// SAFETY: the demo seed creates accounts that hold balances nobody paid for,
// are `verified: true`, and share a well-known password. That is fine for a demo
// deployment and unacceptable on a live one — anyone who guesses an address can
// sign in and cash out real money. Never seed a live build unless someone very
// deliberately asks for it.
// Opt-IN, not opt-out. Gating on SETTLEMENT_MODE wasn't enough: any deployment
// that hadn't set it still got four seeded accounts holding balances nobody
// paid for, and those accounts are what the funding audit kept finding. Seeding
// now happens only when someone explicitly asks for it.
if (process.env.DEMO_SEED !== "true") {
  console.log("[setup-db] Skipping demo seed (set DEMO_SEED=true to seed demo accounts).");
} else {
  try {
    console.log("[setup-db] Seeding demo data (idempotent)…");
    run("npx tsx prisma/seed.ts");
  } catch (e) {
    console.warn("[setup-db] Demo seed skipped:", e?.message ?? e);
  }
}

process.exit(0);
