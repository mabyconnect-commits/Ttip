"use client";

/**
 * Turning notifications on, from the browser's side.
 *
 * Everything fails soft. Notifications are a courtesy — no path here may ever
 * leave someone unable to use the app, and a refused permission is a decision,
 * not an error.
 *
 * On iPhone this only works once the app has been added to the Home Screen.
 * That is Apple's rule, not ours, and `pushBlockedReason` exists so the UI can
 * say so plainly instead of showing a switch that does nothing.
 */

export type PushState = "on" | "off" | "denied" | "unsupported" | "needs-install";

function standalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari's own flag, which predates the standard one.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Why the switch can't be offered, or null when it can. */
export function pushBlockedReason(): string | null {
  if (typeof window === "undefined") return "unsupported";
  if (isIos() && !standalone()) {
    return "On iPhone, add Ttip to your Home Screen first — Apple only allows notifications for installed apps.";
  }
  if (!pushSupported()) return "This browser can't do notifications. Try Chrome, or install the app.";
  return null;
}

/** Where things currently stand, without prompting for anything. */
export async function pushState(): Promise<PushState> {
  if (isIos() && !standalone()) return "needs-install";
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    return sub ? "on" : "off";
  } catch {
    return "off";
  }
}

/** base64url → the ArrayBuffer the PushManager insists on. */
function urlBase64ToBytes(base64: string): ArrayBuffer {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i += 1) view[i] = raw.charCodeAt(i);
  return buf;
}

export async function enablePush(): Promise<{ ok: boolean; error?: string }> {
  const blocked = pushBlockedReason();
  if (blocked) return { ok: false, error: blocked };

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return {
        ok: false,
        error:
          permission === "denied"
            ? "Notifications are blocked for this site — allow them in your browser settings."
            : undefined, // dismissed: they simply chose not to decide
      };
    }

    const keyRes = await fetch("/api/push");
    const { publicKey, configured } = await keyRes.json();
    if (!configured || !publicKey) return { ok: false, error: "Notifications aren't switched on yet." };

    // Registering here as well as in the install prompt: someone can reach this
    // switch before the service worker has ever been registered.
    const reg =
      (await navigator.serviceWorker.getRegistration()) ??
      (await navigator.serviceWorker.register("/sw.js"));
    await navigator.serviceWorker.ready;

    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBytes(publicKey),
      }));

    const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    const res = await fetch("/api/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: body?.error ?? "Couldn't turn notifications on." };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Couldn't turn notifications on." };
  }
}

export async function disablePush(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    const endpoint = sub?.endpoint;
    await sub?.unsubscribe().catch(() => {});
    await fetch(`/api/push${endpoint ? `?endpoint=${encodeURIComponent(endpoint)}` : ""}`, {
      method: "DELETE",
    });
  } catch {
    /* best effort — the switch flips either way */
  }
}
