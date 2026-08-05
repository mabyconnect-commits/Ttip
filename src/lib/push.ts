import "server-only";
import { prisma } from "./db";

/**
 * Push notifications — "₦13,755.08 has been credited to your Ttip wallet",
 * on the lock screen, the moment it happens.
 *
 * Web Push (VAPID), not a vendor SDK: it needs no Firebase project, no account
 * with anyone, and it already works on Android Chrome and on iOS 16.4+ for a
 * PWA added to the home screen — which is how most people here install this
 * app. A native FCM/APNs path can sit behind the same `notifyUser` later
 * without any caller changing.
 *
 * Two rules, both because this is money:
 *
 *   1. A notification NEVER blocks or fails a transaction. Every send is
 *      fire-and-forget and swallows its own errors. A deposit that credited
 *      must not be undone because a push service had a bad minute.
 *   2. It carries no secret. A lock screen is readable by whoever is holding
 *      the phone — so an amount and an asset, never an account number, never a
 *      balance, never a PIN or a reference someone could act on.
 */

export interface PushMessage {
  title: string;
  body: string;
  /** Where tapping it should land. Defaults to the notifications screen. */
  url?: string;
  /** Collapses same-kind notifications instead of stacking them. */
  tag?: string;
}

function keys(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  // mailto: is what the spec wants; a URL is accepted too.
  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:support@ttip.site";
  return { publicKey, privateKey, subject };
}

export function pushConfigured(): boolean {
  return keys() !== null;
}

/** The public key the browser needs to subscribe. Safe to hand out. */
export function pushPublicKey(): string | null {
  return keys()?.publicKey ?? null;
}

/**
 * Send to every device a user has registered.
 *
 * Returns how many were delivered, but nobody has to care: the point is that
 * this can be called from inside a settlement path and be certain it cannot
 * throw.
 */
export async function notifyUser(userId: string, msg: PushMessage): Promise<number> {
  const cfg = keys();
  if (!cfg || !userId) return 0;

  try {
    const subs = await prisma.pushSubscription.findMany({ where: { userId } });
    if (!subs.length) return 0;

    const webpush = (await import("web-push")).default;
    webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);

    const payload = JSON.stringify({
      title: msg.title,
      body: msg.body,
      url: msg.url ?? "/notifications",
      tag: msg.tag,
    });

    let sent = 0;
    const dead: string[] = [];

    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
            { TTL: 60 * 60 },
          );
          sent += 1;
        } catch (e: unknown) {
          const status = (e as { statusCode?: number })?.statusCode;
          // 404/410: the browser threw the subscription away — uninstalled,
          // permission revoked, cleared data. Keeping it would mean retrying
          // for ever against an endpoint that will never answer again.
          if (status === 404 || status === 410) dead.push(s.endpoint);
          else console.error("[push] send failed", status ?? e);
        }
      }),
    );

    if (dead.length) {
      await prisma.pushSubscription.deleteMany({ where: { endpoint: { in: dead } } }).catch(() => {});
    }
    if (sent) {
      await prisma.pushSubscription
        .updateMany({ where: { userId }, data: { lastSentAt: new Date() } })
        .catch(() => {});
    }
    return sent;
  } catch (e) {
    console.error("[push] notifyUser failed", e);
    return 0;
  }
}

/** Format money the way the notification should read it. */
export function pushMoney(amount: number, symbol: string): string {
  const fiat: Record<string, string> = { NGN: "₦", USD: "$", GHS: "₵", KES: "KSh", ZAR: "R" };
  const sign = fiat[symbol.toUpperCase()];
  if (sign) {
    return `${sign}${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  // Crypto: enough decimals to be meaningful, no trailing noise.
  const dp = amount >= 1 ? 2 : 6;
  return `${Number(amount.toFixed(dp))} ${symbol.toUpperCase()}`;
}
