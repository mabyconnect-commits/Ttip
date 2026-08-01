import {
  CRYPTO_ASSETS,
  CRYPTO_BY_SYMBOL,
  FALLBACK_USD_PRICE,
  FIAT_USD_RATE,
} from "./constants";

export interface PriceInfo {
  symbol: string;
  usd: number;
  change24h: number; // percent
}

interface Cache {
  at: number;
  data: Record<string, PriceInfo>;
}

// In-memory cache shared per server instance. Refreshes at most once/60s.
const globalForPrices = globalThis as unknown as { __ttipPrices?: Cache };
const TTL = 60_000;

async function fetchLive(): Promise<Record<string, PriceInfo> | null> {
  const ids = CRYPTO_ASSETS.map((a) => a.coingeckoId).join(",");
  const key = process.env.COINGECKO_API_KEY;
  const base = key
    ? "https://api.coingecko.com/api/v3/simple/price"
    : "https://api.coingecko.com/api/v3/simple/price";
  const url = `${base}?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
  try {
    const res = await fetch(url, {
      headers: key ? { "x-cg-demo-api-key": key } : {},
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, { usd: number; usd_24h_change?: number }>;
    const out: Record<string, PriceInfo> = {};
    for (const asset of CRYPTO_ASSETS) {
      const row = json[asset.coingeckoId];
      if (row && typeof row.usd === "number") {
        out[asset.symbol] = {
          symbol: asset.symbol,
          usd: row.usd,
          change24h: row.usd_24h_change ?? 0,
        };
      }
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

function fallback(): Record<string, PriceInfo> {
  const out: Record<string, PriceInfo> = {};
  for (const asset of CRYPTO_ASSETS) {
    out[asset.symbol] = {
      symbol: asset.symbol,
      usd: FALLBACK_USD_PRICE[asset.symbol] ?? 1,
      change24h: 0,
    };
  }
  return out;
}

export async function getPrices(): Promise<Record<string, PriceInfo>> {
  const cache = globalForPrices.__ttipPrices;
  if (cache && Date.now() - cache.at < TTL) return cache.data;

  const live = await fetchLive();
  const data = live ?? cache?.data ?? fallback();
  globalForPrices.__ttipPrices = { at: Date.now(), data };
  return data;
}

/** USD price for one unit of a crypto symbol. */
export async function usdPrice(symbol: string): Promise<number> {
  const prices = await getPrices();
  return prices[symbol]?.usd ?? FALLBACK_USD_PRICE[symbol] ?? 1;
}

// ---- Live fiat FX rates (USD value of one unit of each fiat) ----
interface FxCache {
  at: number;
  data: Record<string, number>;
}
const globalForFx = globalThis as unknown as { __ttipFx?: FxCache };
const FX_TTL = 30 * 60 * 1000; // fiat moves slowly; refresh every 30 min

async function fetchFiatRates(): Promise<Record<string, number> | null> {
  // Free, no-key FX feed (mid-market). Two mirrors for reliability.
  const urls = [
    "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json",
    "https://latest.currency-api.pages.dev/v1/currencies/usd.min.json",
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { next: { revalidate: 1800 } });
      if (!res.ok) continue;
      const json = (await res.json()) as { usd?: Record<string, number> };
      const usd = json.usd;
      if (!usd) continue;
      const out: Record<string, number> = { USD: 1 };
      for (const code of ["NGN", "GHS", "KES", "ZAR", "XOF", "XAF", "UGX", "TZS", "RWF", "ZMW", "EGP", "MAD", "ETB"]) {
        const perUsd = usd[code.toLowerCase()];
        if (typeof perUsd === "number" && perUsd > 0) out[code] = 1 / perUsd; // USD per 1 unit
      }
      if (Object.keys(out).length > 1) return out;
    } catch {
      /* try next mirror */
    }
  }
  return null;
}

/** USD value of one unit of each supported fiat, live where possible. */
export async function getFiatRates(): Promise<Record<string, number>> {
  const cache = globalForFx.__ttipFx;
  if (cache && Date.now() - cache.at < FX_TTL) return cache.data;
  const live = await fetchFiatRates();
  const data = live ?? cache?.data ?? FIAT_USD_RATE;
  globalForFx.__ttipFx = { at: Date.now(), data };
  return data;
}

/** Convert an amount of `from` asset into `to` asset. Both can be crypto or fiat. */
export async function convert(amount: number, from: string, to: string): Promise<number> {
  if (from === to) return amount;
  const usdValue = await toUsd(amount, from);
  return fromUsd(usdValue, to);
}

export async function toUsd(amount: number, symbol: string): Promise<number> {
  const fx = await getFiatRates();
  if (fx[symbol] !== undefined) return amount * fx[symbol];
  return amount * (await usdPrice(symbol));
}

export async function fromUsd(usd: number, symbol: string): Promise<number> {
  const fx = await getFiatRates();
  if (fx[symbol] !== undefined) return usd / fx[symbol];
  return usd / (await usdPrice(symbol));
}

export function isCrypto(symbol: string): boolean {
  return CRYPTO_BY_SYMBOL[symbol] !== undefined;
}
