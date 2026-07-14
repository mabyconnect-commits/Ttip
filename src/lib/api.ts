import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function unauthorized() {
  return NextResponse.json({ error: "Not signed in" }, { status: 401 });
}

/** Wrap a route handler to turn thrown errors / Zod errors into JSON responses. */
export function handler(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  return fn().catch((err) => {
    if (err instanceof ZodError) {
      return fail(err.errors[0]?.message ?? "Invalid input", 422);
    }
    if (err instanceof ApiError) {
      return fail(err.message, err.status);
    }
    console.error("[api] unhandled", err);
    return fail(describeError(err), 500);
  });
}

/** Turn low-level infrastructure errors into a message that tells the operator what to fix. */
function describeError(err: unknown): string {
  const name = (err as { name?: string })?.name ?? "";
  const code = (err as { code?: string })?.code ?? "";
  const msg = String((err as { message?: string })?.message ?? "");

  // Missing / misconfigured auth secret
  if (msg.includes("AUTH_SECRET")) {
    return "Server not configured: AUTH_SECRET is missing. Set it in your Vercel environment variables.";
  }
  // Prisma: cannot connect to the database
  if (name === "PrismaClientInitializationError" || code === "P1000" || code === "P1001" || msg.includes("DATABASE_URL")) {
    return "Database not reachable. Check that DATABASE_URL is set correctly in your Vercel environment variables.";
  }
  // Prisma: tables don't exist yet
  if (code === "P2021" || code === "P2022" || msg.includes("does not exist in the current database")) {
    return "Database tables are missing. Redeploy (the build creates them), or run `npm run db:push` against your database.";
  }
  return "Something went wrong. If this is a fresh deploy, make sure DATABASE_URL and AUTH_SECRET are set in Vercel, then redeploy.";
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
