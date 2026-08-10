import "server-only";
import { isLive } from "./config";

/**
 * Buying gift cards — Amazon, Google Play, PlayStation, Steam, the rest.
 *
 * This is the HALF of gift cards that is safe to automate. Selling a card to a
 * user is fulfilment: we buy a code from a distributor and hand it over, and if
 * the purchase fails nobody has paid. BUYING cards from users is a different
 * business entirely — no API can verify that a card is real and unspent, the
 * incumbents do it with rooms of human reviewers, and the fraud lands on
 * whoever paid out first. That side is deliberately not here.
 *
 * Reloadly is the adapter written, for one practical reason: sandbox
 * credentials arrive the moment you sign up, so this is testable today.
 * Bitrefill is the better long-term fit — its catalogue is bigger and it can be
 * paid in crypto straight from treasury, which would skip the naira float
 * entirely — but it needs an approved business account first. Both sit behind
 * the same interface, so that swap is one file.
 */

export interface GiftCardProduct {
  id: string;
  brand: string;
  country: string;
  currency: string;
  /** Fixed denominations, when the brand only sells those. */
  denominations: number[];
  /** Range, when the brand allows any amount between them. */
  min?: number;
  max?: number;
  logo?: string;
  /** What the distributor charges us, as a fraction of face value (0.94 = 6% off). */
  costRate: number;
}

export interface GiftCardOrderResult {
  ok: boolean;
  providerRef?: string;
  /** Present when the provider hands the code over immediately. */
  code?: string;
  pin?: string;
  message?: string;
  /** True when the order was accepted but the code comes later. */
  pending?: boolean;
}

export interface GiftCardProvider {
  name: string;
  products(country: string): Promise<GiftCardProduct[]>;
  order(input: {
    productId: string;
    unitPrice: number;
    reference: string;
    recipientEmail: string;
    senderName: string;
  }): Promise<GiftCardOrderResult>;
  /** Fetch the code for an order that came back pending. */
  fetchCode(providerRef: string): Promise<{ code?: string; pin?: string } | null>;
  /**
   * Look an order up by OUR reference, for the case where the call threw and we
   * never learned a provider id.
   *
   * `found: false` must mean the provider is certain no such order exists —
   * that answer is what lets a reconcile refund someone. Anything uncertain
   * (network error, auth failure, a shape we don't recognise) returns null, and
   * the order stays pending rather than being refunded on a guess.
   */
  findByReference(reference: string): Promise<{ found: boolean; providerRef?: string } | null>;
}

// ── Reloadly ────────────────────────────────────────────────────────────────

function reloadlyConfig() {
  const clientId = process.env.RELOADLY_CLIENT_ID?.trim();
  const clientSecret = process.env.RELOADLY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  // Sandbox unless explicitly live, so a misconfigured deployment buys nothing
  // real. Opt IN to spending money, never out of it.
  const sandbox = process.env.RELOADLY_SANDBOX === "true" || !isLive();
  return {
    clientId,
    clientSecret,
    sandbox,
    base: sandbox ? "https://giftcards-sandbox.reloadly.com" : "https://giftcards.reloadly.com",
  };
}

/** Tokens last an hour; caching one saves an auth round trip per request. */
let token: { value: string; expiresAt: number } | null = null;

async function reloadlyToken(): Promise<string | null> {
  const cfg = reloadlyConfig();
  if (!cfg) return null;
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;

  try {
    const res = await fetch("https://auth.reloadly.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        grant_type: "client_credentials",
        audience: cfg.base,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!res.ok || !json.access_token) {
      console.error(`[giftcard] reloadly auth failed (${res.status})`);
      return null;
    }
    token = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
    return token.value;
  } catch (e) {
    console.error("[giftcard] reloadly auth threw", e);
    return null;
  }
}

const ACCEPT = "application/com.reloadly.giftcards-v1+json";

interface RlProduct {
  productId?: number;
  productName?: string;
  country?: { isoName?: string };
  recipientCurrencyCode?: string;
  senderCurrencyCode?: string;
  fixedRecipientDenominations?: number[];
  minRecipientDenomination?: number | null;
  maxRecipientDenomination?: number | null;
  discountPercentage?: number;
  logoUrls?: string[];
}

const reloadly: GiftCardProvider = {
  name: "reloadly",

  async products(country) {
    const cfg = reloadlyConfig();
    const t = await reloadlyToken();
    if (!cfg || !t) return [];
    try {
      const res = await fetch(`${cfg.base}/countries/${country}/products?size=200`, {
        headers: { Authorization: `Bearer ${t}`, Accept: ACCEPT },
      });
      if (!res.ok) {
        console.error(`[giftcard] reloadly products ${res.status}: ${await res.text().catch(() => "")}`);
        return [];
      }
      const body = (await res.json().catch(() => null)) as { content?: RlProduct[] } | RlProduct[] | null;
      const list = Array.isArray(body) ? body : (body?.content ?? []);
      return list
        .filter((p) => p.productId && p.productName)
        .map((p) => ({
          id: String(p.productId),
          brand: p.productName!,
          country: p.country?.isoName ?? country,
          currency: p.recipientCurrencyCode ?? "USD",
          denominations: p.fixedRecipientDenominations ?? [],
          min: p.minRecipientDenomination ?? undefined,
          max: p.maxRecipientDenomination ?? undefined,
          logo: p.logoUrls?.[0],
          // A discount of 6 means they sell us face value at 94%.
          costRate: 1 - (Number(p.discountPercentage) || 0) / 100,
        }));
    } catch (e) {
      console.error("[giftcard] reloadly products threw", e);
      return [];
    }
  },

  async order(input) {
    const cfg = reloadlyConfig();
    const t = await reloadlyToken();
    if (!cfg || !t) return { ok: false, message: "Gift cards aren't configured on this deployment." };

    try {
      const res = await fetch(`${cfg.base}/orders`, {
        method: "POST",
        headers: { Authorization: `Bearer ${t}`, Accept: ACCEPT, "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: Number(input.productId),
          quantity: 1,
          unitPrice: input.unitPrice,
          // Our reference, so a retry can't buy a second card.
          customIdentifier: input.reference,
          senderName: input.senderName,
          recipientEmail: input.recipientEmail,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        transactionId?: number;
        message?: string;
        status?: string;
      };
      if (!res.ok) {
        console.error(`[giftcard] reloadly order ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
        return { ok: false, message: body.message ?? `The gift card provider refused that (${res.status}).` };
      }
      const ref = body.transactionId ? String(body.transactionId) : undefined;
      if (!ref) return { ok: false, message: "The provider didn't return an order id." };

      // The code is fetched separately, and often isn't ready on the first ask.
      const card = await reloadly.fetchCode(ref);
      if (card?.code) return { ok: true, providerRef: ref, code: card.code, pin: card.pin };
      return { ok: true, providerRef: ref, pending: true };
    } catch (e) {
      // A throw is NOT a failure — the order may have been placed. Held as
      // pending so a reconcile decides, never refunded on a guess.
      console.error("[giftcard] reloadly order threw", e);
      return { ok: true, pending: true, message: `No response from the provider: ${(e as Error).message}` };
    }
  },

  async fetchCode(providerRef) {
    const cfg = reloadlyConfig();
    const t = await reloadlyToken();
    if (!cfg || !t) return null;
    try {
      const res = await fetch(`${cfg.base}/orders/transactions/${encodeURIComponent(providerRef)}/cards`, {
        headers: { Authorization: `Bearer ${t}`, Accept: ACCEPT },
      });
      if (!res.ok) return null;
      const body = (await res.json().catch(() => null)) as { cardNumber?: string; pinCode?: string }[] | null;
      const first = Array.isArray(body) ? body[0] : null;
      if (!first?.cardNumber) return null;
      return { code: first.cardNumber, pin: first.pinCode || undefined };
    } catch {
      return null;
    }
  },

  async findByReference(reference) {
    const cfg = reloadlyConfig();
    const t = await reloadlyToken();
    if (!cfg || !t) return null;
    try {
      const res = await fetch(
        `${cfg.base}/reports/transactions?customIdentifier=${encodeURIComponent(reference)}&size=1`,
        { headers: { Authorization: `Bearer ${t}`, Accept: ACCEPT } },
      );
      // A non-200 tells us nothing about whether the order exists.
      if (!res.ok) return null;
      const body = (await res.json().catch(() => null)) as
        | { content?: { transactionId?: number }[] }
        | { transactionId?: number }[]
        | null;
      if (!body) return null;
      const list = Array.isArray(body) ? body : body.content;
      // A missing `content` is an unrecognised shape, not an empty result.
      if (!Array.isArray(list)) return null;
      const hit = list[0];
      if (!hit) return { found: false };
      return { found: true, providerRef: hit.transactionId ? String(hit.transactionId) : undefined };
    } catch {
      return null;
    }
  },
};

// ── Sandbox ─────────────────────────────────────────────────────────────────

/**
 * A working catalogue with no provider account, so the whole flow — browse,
 * pay, reveal, refund — can be exercised end to end before a single real card
 * is bought. The codes it issues are obviously fake, on purpose.
 */
const sandbox: GiftCardProvider = {
  name: "sandbox",
  async products() {
    const mk = (id: string, brand: string, denominations: number[]): GiftCardProduct => ({
      id,
      brand,
      country: "US",
      currency: "USD",
      denominations,
      costRate: 0.94,
    });
    return [
      mk("sbx-amazon", "Amazon", [5, 10, 25, 50, 100]),
      mk("sbx-googleplay", "Google Play", [10, 25, 50]),
      mk("sbx-playstation", "PlayStation Store", [10, 25, 50, 100]),
      mk("sbx-steam", "Steam", [20, 50, 100]),
      mk("sbx-itunes", "Apple / iTunes", [10, 25, 50]),
      mk("sbx-xbox", "Xbox", [10, 25, 50]),
    ];
  },
  async order(input) {
    const rand = () => Math.random().toString(36).toUpperCase().slice(2, 6);
    return { ok: true, providerRef: `sbx_${input.reference}`, code: `SBX-${rand()}-${rand()}-${rand()}` };
  },
  async fetchCode() {
    return null;
  },
  async findByReference() {
    // The sandbox hands the code back in `order`, so nothing here is ever
    // pending — and a definite "no such order" is the right answer.
    return { found: false };
  },
};

export function giftCardProvider(): GiftCardProvider {
  return reloadlyConfig() ? reloadly : sandbox;
}

/** Whether a real provider is wired up, for the screen to be honest about. */
export function giftCardsLive(): boolean {
  return !!reloadlyConfig();
}

/**
 * Our markup on top of what the distributor charges.
 *
 * The distributor sells face value at a discount (typically 4–7%); this decides
 * how much of that we keep. Default 3 points, so a card bought at 94% is sold
 * at 97% of face — the user still saves against buying it retail, and the
 * platform earns on every one.
 */
export function giftCardMarkup(): number {
  const raw = (process.env.GIFTCARD_MARKUP_PCT ?? "").trim();
  const n = Number(raw);
  return raw !== "" && Number.isFinite(n) && n >= 0 && n < 0.5 ? n : 0.03;
}

/**
 * What a card of `faceValue` costs the user, in the card's own currency.
 *
 * Never below face value cost — a markup that made a card cheaper than we paid
 * would be a loss on every sale, and a mis-set env var must not be able to do
 * that quietly.
 */
export function giftCardPrice(faceValue: number, costRate: number): number {
  const rate = Number.isFinite(costRate) && costRate > 0 && costRate <= 1 ? costRate : 1;
  const price = faceValue * Math.min(1, rate + giftCardMarkup());
  return Math.max(price, faceValue * rate);
}
