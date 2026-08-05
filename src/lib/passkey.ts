"use client";

/**
 * Face ID / fingerprint sign-in, from the browser's side.
 *
 * Everything here is a thin wrapper: the actual work happens in the phone's
 * secure hardware, which is the point. Nothing biometric is read, sent or
 * stored by us — the device unlocks a private key locally and hands back a
 * signature.
 *
 * Every function fails soft. A passkey is an alternative to the password, never
 * a replacement for it, so if the platform doesn't support it, the user
 * cancels, or anything goes wrong, the answer is "carry on with the password"
 * rather than an error screen.
 */

export interface PasskeyOutcome<T> {
  ok: boolean;
  data?: T;
  /** Set when it's worth telling the user. Silent on a plain cancellation. */
  error?: string;
}

/** Whether this browser can do WebAuthn at all. */
export function passkeySupported(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential;
}

/**
 * Whether this device can BE the authenticator — Face ID, Touch ID, a
 * fingerprint sensor — rather than needing a plugged-in security key. This is
 * what decides whether offering "Sign in with Face ID" is honest.
 */
export async function deviceCanAuthenticate(): Promise<boolean> {
  if (!passkeySupported()) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** A cancelled prompt is a decision, not a failure — don't shout about it. */
function isCancellation(e: unknown): boolean {
  const name = (e as { name?: string })?.name;
  return name === "NotAllowedError" || name === "AbortError";
}

async function json(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? "Something went wrong");
  return body;
}

/** Add this device to the signed-in account. */
export async function registerPasskey(): Promise<PasskeyOutcome<{ added: string }>> {
  try {
    const { startRegistration } = await import("@simplewebauthn/browser");
    const { options } = await json("/api/auth/passkey/register");
    const response = await startRegistration({ optionsJSON: options });
    const done = await json("/api/auth/passkey/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response }),
    });
    return { ok: true, data: done };
  } catch (e: any) {
    if (isCancellation(e)) return { ok: false };
    // The one worth naming: this device is already on the account.
    if (e?.name === "InvalidStateError") {
      return { ok: false, error: "This device is already set up for your account." };
    }
    return { ok: false, error: e?.message ?? "Couldn't set that up — try again." };
  }
}

/**
 * Sign in with the device. Returns the app state on success, exactly as the
 * password login does, so the caller doesn't care which route was taken.
 */
export async function signInWithPasskey(): Promise<PasskeyOutcome<any>> {
  try {
    const { startAuthentication } = await import("@simplewebauthn/browser");
    const { options } = await json("/api/auth/passkey/login");
    const response = await startAuthentication({ optionsJSON: options });
    const state = await json("/api/auth/passkey/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response }),
    });
    return { ok: true, data: state };
  } catch (e: any) {
    if (isCancellation(e)) return { ok: false };
    return { ok: false, error: e?.message ?? "That didn't work — use your password." };
  }
}
