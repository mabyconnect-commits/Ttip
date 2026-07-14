import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// Quick diagnostics: is the DB reachable, are tables created, is auth configured?
export async function GET() {
  const out: Record<string, unknown> = {
    app: "ok",
    env: {
      DATABASE_URL: !!process.env.DATABASE_URL,
      AUTH_SECRET: !!process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 16,
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? null,
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
