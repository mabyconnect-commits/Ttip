import "server-only";
import { cookies, headers } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

/**
 * Signing in with Face ID or a fingerprint — passkeys (WebAuthn).
 *
 * Worth being clear about what this is, because "fingerprint login" sounds like
 * we receive a fingerprint. We never do. The phone keeps a private key in its
 * secure hardware, unlocks it with the biometric locally, and sends us a
 * signature. We store only the PUBLIC key, which can check a signature and
 * cannot produce one — so there is no shared secret to phish, reuse across
 * sites, or leak in a breach. That is the actual security win over a password,
 * not the convenience.
 *
 * The challenge is held in a short-lived signed cookie rather than a table:
 * it is one value, valid for one attempt, for a couple of minutes. Signing it
 * means the browser can hold it without being able to choose it.
 */

const CHALLENGE_COOKIE = "ttip_wa";
const CHALLENGE_TTL_SECONDS = 180;
const alg = "HS256";

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(s);
}

/**
 * The Relying Party id — the domain the credential is bound to.
 *
 * A passkey is locked to this value, so it must stay stable: change it and
 * every passkey ever registered stops working. Derived from the request host
 * (minus any port) unless WEBAUTHN_RP_ID pins it, which is what you want when
 * the app is reached on both ttip.site and www.ttip.site — register on one and
 * a credential scoped to the other won't be offered.
 */
export function rpId(): string {
  const pinned = process.env.WEBAUTHN_RP_ID?.trim();
  if (pinned) return pinned;
  const host = (headers().get("host") ?? "").split(":")[0];
  // A registrable suffix: www.ttip.site registers against ttip.site so both work.
  return host.startsWith("www.") ? host.slice(4) : host || "localhost";
}

/** Origins a passkey assertion may come from. */
export function allowedOrigins(): string[] {
  const extra = (process.env.WEBAUTHN_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const host = headers().get("host");
  const proto = headers().get("x-forwarded-proto") ?? "https";
  const id = rpId();
  const here: string[] = [];
  if (host) {
    here.push(`${proto}://${host}`);
    // A browser treats localhost as a secure origin and will do WebAuthn over
    // plain http there. Without this, passkeys work in production and silently
    // don't on a development machine, which is the worst way round.
    if (/^(localhost|127\.0\.0\.1)$/.test(id)) here.push(`http://${host}`);
  }
  return Array.from(new Set([...extra, ...here, `https://${id}`, `https://www.${id}`]));
}

export const rpName = "Ttip";

/** Remember the challenge we just issued, for the one attempt that follows. */
export async function stashChallenge(challenge: string, purpose: "register" | "login"): Promise<void> {
  const token = await new SignJWT({ c: challenge, p: purpose })
    .setProtectedHeader({ alg })
    .setIssuedAt()
    .setExpirationTime(`${CHALLENGE_TTL_SECONDS}s`)
    .sign(secret());

  cookies().set(CHALLENGE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: CHALLENGE_TTL_SECONDS,
  });
}

/**
 * Read back the challenge, and burn it.
 *
 * Single use: a challenge that can be replayed is not a challenge. It is
 * cleared whether or not verification then succeeds, so a failed attempt can't
 * be retried against the same value.
 */
export async function takeChallenge(purpose: "register" | "login"): Promise<string | null> {
  const raw = cookies().get(CHALLENGE_COOKIE)?.value;
  cookies().set(CHALLENGE_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  if (!raw) return null;
  try {
    const { payload } = await jwtVerify(raw, secret());
    if (payload.p !== purpose) return null;
    return typeof payload.c === "string" ? payload.c : null;
  } catch {
    return null;
  }
}

/** A friendly name for a new credential, from the browser's own user-agent. */
export function deviceLabel(userAgent: string | null): string {
  const ua = userAgent ?? "";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Macintosh/i.test(ua)) return "Mac";
  if (/Android/i.test(ua)) return "Android phone";
  if (/Windows/i.test(ua)) return "Windows PC";
  return "This device";
}
