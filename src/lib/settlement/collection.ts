import "server-only";
import { isLive, paystackConfig, flutterwaveConfig } from "./config";
import { toSubunit } from "./webhook";

/**
 * Fiat collection (charge a user's card/bank to bring money IN) — the front half
 * of the buy-crypto on-ramp. The user pays naira via a hosted checkout; on
 * success we credit them crypto from treasury at the locked buy quote.
 *
 *   - sandbox: the charge "succeeds" instantly, so the buy flow is demoable.
 *   - live: Flutterwave or Paystack returns a Ttip-branded checkout URL; the
 *     charge is confirmed later by the collection webhook.
 */

export type CollectionProvider = "sandbox" | "paystack" | "flutterwave";

/**
 * Which provider collects fiat. Explicit COLLECTION_PROVIDER wins; otherwise we
 * pick whichever provider has a key (Flutterwave first). Sandbox off-live.
 */
export function collectionProvider(): CollectionProvider {
  if (!isLive()) return "sandbox";
  const explicit = process.env.COLLECTION_PROVIDER?.toLowerCase();
  if (explicit === "flutterwave" || explicit === "paystack") return explicit;
  if (process.env.FLUTTERWAVE_SECRET_KEY) return "flutterwave";
  if (process.env.PAYSTACK_SECRET_KEY) return "paystack";
  return "sandbox";
}

/** Ttip-branded checkout customizations, so customers see "Ttip" not the entity. */
function branding(callbackUrl?: string) {
  let logo: string | undefined;
  try {
    if (callbackUrl) logo = new URL(callbackUrl).origin + "/ttip-logo.png";
  } catch {
    /* ignore */
  }
  return { title: "Ttip", description: "Buy crypto on Ttip", logo };
}

export interface CollectionRequest {
  userId: string;
  email: string;
  amountFiat: number;
  currency: string; // NGN, GHS, …
  reference: string; // our idempotency reference
  callbackUrl?: string; // where Paystack returns the user after payment
}

export interface CollectionInit {
  provider: CollectionProvider;
  status: "pending" | "completed" | "failed";
  externalId: string;
  checkoutUrl?: string; // hosted payment page (live)
  message?: string;
}

export async function initCollection(req: CollectionRequest): Promise<CollectionInit> {
  const provider = collectionProvider();

  if (provider === "flutterwave") {
    const cfg = flutterwaveConfig();
    if (!cfg) return { provider: "flutterwave", status: "failed", externalId: req.reference, message: "Flutterwave not configured" };
    const res = await fetch(`${cfg.baseUrl}/payments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.secretKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        tx_ref: req.reference,
        amount: req.amountFiat,
        currency: req.currency,
        redirect_url: req.callbackUrl,
        customer: { email: req.email },
        customizations: branding(req.callbackUrl),
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { status?: string; data?: { link?: string }; message?: string };
    if (!res.ok || json.status !== "success" || !json.data?.link) {
      return { provider: "flutterwave", status: "failed", externalId: req.reference, message: json.message ?? "Could not start checkout" };
    }
    return { provider: "flutterwave", status: "pending", externalId: req.reference, checkoutUrl: json.data.link };
  }

  if (provider === "paystack") {
    const cfg = paystackConfig();
    if (!cfg) return { provider: "paystack", status: "failed", externalId: req.reference, message: "Paystack not configured" };
    const res = await fetch(`${cfg.baseUrl}/transaction/initialize`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.secretKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: req.email,
        amount: toSubunit(req.amountFiat),
        currency: req.currency,
        reference: req.reference,
        ...(req.callbackUrl ? { callback_url: req.callbackUrl } : {}),
        metadata: { source: "ttip-buy", userId: req.userId },
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { data?: { authorization_url?: string; reference?: string }; message?: string };
    if (!res.ok || !json.data?.authorization_url) {
      return { provider: "paystack", status: "failed", externalId: req.reference, message: json.message ?? "Could not start checkout" };
    }
    return { provider: "paystack", status: "pending", externalId: json.data.reference ?? req.reference, checkoutUrl: json.data.authorization_url };
  }

  // Sandbox: treat as paid immediately.
  return { provider: "sandbox", status: "completed", externalId: req.reference };
}
