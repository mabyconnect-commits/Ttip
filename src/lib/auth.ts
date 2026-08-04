import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { prisma } from "./db";

const COOKIE = "ttip_session";
const alg = "HS256";

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    throw new Error("AUTH_SECRET is not set. Add it to your environment.");
  }
  return new TextEncoder().encode(s);
}

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

/** The session cookie's name. Exported so a server-side caller can build one. */
export const SESSION_COOKIE = COOKIE;

/**
 * Mint a session token for a user.
 *
 * Split out of createSession so a trusted server-side caller can obtain one
 * without a browser — the Telegram bot uses it to call our own /api/send as the
 * linked user, which keeps every check in that endpoint (PIN, KYC, limits,
 * idempotency) instead of growing a second copy of the payout path. `ttl` is
 * short for that use: the token exists for one internal request.
 */
export async function signSessionToken(userId: string, ttl = "30d"): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg })
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(secret());
}

export async function createSession(userId: string): Promise<void> {
  const token = await signSessionToken(userId);

  cookies().set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function destroySession(): void {
  cookies().set(COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export async function getUserId(): Promise<string | null> {
  const token = cookies().get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return (payload.sub as string) ?? null;
  } catch {
    return null;
  }
}

/** Load the current user with balances + card, or null. */
export async function getCurrentUser() {
  const id = await getUserId();
  if (!id) return null;
  return prisma.user.findUnique({
    where: { id },
    include: { balances: true, card: true, addresses: true },
  });
}

export type SessionUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
