import "server-only";
import { isLive, paystackConfig } from "./config";
import { toSubunit } from "./webhook";

/**
 * Fiat collection (charge a user's card/bank to bring money IN) — the front half
 * of the buy-crypto on-ramp. The user pays naira via a hosted checkout; on
 * success we credit them crypto from treasury at the locked buy quote.
 *
 *   - sandbox: the charge "succeeds" instantly, so the buy flow is demoable.
 *   - live: Paystack initializes a transaction and returns a checkout URL; the
 *     charge is confirmed later by the collection webhook.
 */

export type CollectionProvider = "sandbox" | "paystack";

export function collectionProvider(): CollectionProvider {
  if (!isLive()) return "sandbox";
  if (process.env.PAYSTACK_SECRET_KEY) return "paystack";
  return "sandbox";
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
  if (collectionProvider() === "paystack") {
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
