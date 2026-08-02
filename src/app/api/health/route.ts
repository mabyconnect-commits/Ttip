import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { settlementMode, payoutProvider, depositProvider } from "@/lib/settlement/config";

export const dynamic = "force-dynamic";

// Quick diagnostics: is the DB reachable, are tables created, is auth configured,
// and are the settlement providers wired? Only booleans/names are reported —
// never a secret value.
export async function GET() {
  const out: Record<string, unknown> = {
    app: "ok",
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
    deployedAt: process.env.VERCEL_GIT_COMMIT_MESSAGE?.split("\n")[0] ?? null,
    env: {
      DATABASE_URL: !!process.env.DATABASE_URL,
      AUTH_SECRET: !!process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 16,
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? null,
    },
    settlement: {
      mode: settlementMode(), // "sandbox" | "live"
      depositProvider: depositProvider(), // "dextopus" | "sandbox"
      payoutProvider: payoutProvider(), // "sandbox" | "paystack" | ...
      dextopus: {
        apiKey: !!process.env.DEXTOPUS_API_KEY,
        webhookSecret: !!process.env.DEXTOPUS_WEBHOOK_SECRET,
        settlementTarget: !!(
          process.env.DEXTOPUS_SETTLEMENT_CHAIN_ID &&
          process.env.DEXTOPUS_SETTLEMENT_ASSET &&
          process.env.DEXTOPUS_SETTLEMENT_ADDRESS
        ),
      },
      payoutKeys: {
        paystack: !!process.env.PAYSTACK_SECRET_KEY,
        flutterwave: !!process.env.FLUTTERWAVE_SECRET_KEY,
        monnify: !!process.env.MONNIFY_SECRET_KEY,
        coralpay: !!process.env.CORALPAY_SECRET_KEY,
      },
    },
    database: "unknown",
    tables: "unknown",
    demoSeeded: false,
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    out.database = "connected";
    try {
      const users = await prisma.user.count();
      out.tables = "ready";
      out.userCount = users;
      out.demoSeeded = (await prisma.user.count({ where: { username: "kola" } })) > 0;
    } catch {
      out.tables = "missing — redeploy or run `npm run db:push`";
    }
  } catch (e) {
    out.database = "unreachable — check DATABASE_URL";
    out.detail = (e as { message?: string })?.message ?? String(e);
  }

  const healthy = out.database === "connected" && out.tables === "ready" && (out.env as any).AUTH_SECRET;
  return NextResponse.json(out, { status: healthy ? 200 : 503 });
}
