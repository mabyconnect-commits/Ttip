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
    return fail("Something went wrong", 500);
  });
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
