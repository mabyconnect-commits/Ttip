import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized } from "@/lib/api";
import { prisma } from "@/lib/db";
import { giftCardProvider, giftCardPrice, giftCardsLive } from "@/lib/settlement/giftcard";
import { convert } from "@/lib/prices";
import { spendableFiat } from "@/lib/spendable";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The gift card catalogue, priced in the user's own currency.
 *
 * Every denomination is converted here rather than on the client, so the price
 * on the button is the price the server charges. Two answers to "what does this
 * cost" is how someone taps ₦38,000 and gets charged ₦39,200.
 */

/** Brands people in this market actually ask for, first. */
const POPULAR = [
  "amazon",
  "google play",
  "playstation",
  "steam",
  "itunes",
  "apple",
  "xbox",
  "netflix",
  "spotify",
  "visa",
  "ebay",
  "walmart",
];

function rank(brand: string): number {
  const b = brand.toLowerCase();
  const i = POPULAR.findIndex((p) => b.includes(p));
  return i === -1 ? POPULAR.length : i;
}

export async function GET(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { defaultFiat: true, balances: true },
    });
    const fiat = user?.defaultFiat ?? "NGN";
    const country = (new URL(req.url).searchParams.get("country") || "US").toUpperCase();

    const products = await giftCardProvider().products(country);

    // What they can actually afford, so the screen can grey out the rest
    // rather than letting someone pick a card and fail at the last step.
    const spend = user ? await spendableFiat(user.balances, fiat).catch(() => null) : null;

    const priced = await Promise.all(
      products
        // Fixed-denomination brands only. Range products ("any amount between
        // $5 and $500") need an amount field and their own validation, and
        // shipping them half-done would let someone buy an amount the
        // distributor then rejects.
        .filter((p) => p.denominations.length > 0)
        .sort((a, b) => rank(a.brand) - rank(b.brand) || a.brand.localeCompare(b.brand))
        .slice(0, 120)
        .map(async (p) => {
          // One rate per product rather than per denomination — same currency,
          // and it keeps this to a handful of conversions instead of hundreds.
          const unit = await convert(1, p.currency, fiat).catch(() => 0);
          return {
            id: p.id,
            brand: p.brand,
            currency: p.currency,
            logo: p.logo,
            options: p.denominations.slice(0, 12).map((face) => {
              const priceInCardCurrency = giftCardPrice(face, p.costRate);
              return {
                face,
                /** What we charge, in the user's currency. */
                cost: unit > 0 ? priceInCardCurrency * unit : 0,
              };
            }),
          };
        }),
    );

    return ok({
      fiat,
      live: giftCardsLive(),
      spendable: spend?.total ?? 0,
      // A product we can't price is left out rather than shown at zero — a
      // zero-cost card is one someone will try to buy for nothing.
      products: priced.filter((p) => p.options.some((o) => o.cost > 0)),
    });
  });
}
