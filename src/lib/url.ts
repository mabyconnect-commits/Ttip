import { headers } from "next/headers";

/**
 * The public base URL for building shareable links (tip links, referral links).
 * Prefers the actual host of the incoming request so links always match the
 * domain the user is on — no stale NEXT_PUBLIC_APP_URL to keep in sync. Falls
 * back to the env var, then empty string.
 */
export function baseUrl(): string {
  try {
    const h = headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) {
      const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
      return `${proto}://${host}`;
    }
  } catch {
    /* headers() unavailable (e.g. build) */
  }
  return (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
}
