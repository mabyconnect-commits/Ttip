/**
 * Live USDT↔fiat reference rate from P2P markets — the real Bybit "street" rate
 * (~₦1,392/USDT), well above the official FX rate.
 *
 * We read the **buy-USDT** side (the price quoted on the app) and take a robust
 * median of the best ads as the single reference rate; our margin is then applied
 * on top (buy = +margin, sell = −margin). Primary: Bybit P2P; backup: Binance
 * P2P; final fallback (both unreachable): official FX, handled by the caller.
 */

const cache = new Map<string, { at: number; rate: number }>();
const TTL_MS = 2 * 60 * 1000; // 2 minutes

function median(nums: number[]): number | null {
  const a = nums.filter((n) => Number.isFinite(n) && n > 0).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/** Bybit: buy-USDT ads (side "1" = merchants selling USDT → the price you pay). */
async function bybitBuyUsdt(currency: string): Promise<number[]> {
  const res = await fetch("https://api2.bybit.com/fiat/otc/item/online", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
    body: JSON.stringify({ tokenId: "USDT", currencyId: currency, payment: [], side: "1", size: "10", page: "1", amount: "", authMaturity: "", itemRegion: 1 }),
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) return [];
  const json = (await res.json().catch(() => null)) as { result?: { items?: { price?: string }[] } } | null;
  return (json?.result?.items ?? []).map((i) => Number(i.price)).filter((p) => p > 0);
}

/** Binance: buy-USDT ads (tradeType BUY → the price you pay to buy USDT). */
async function binanceBuyUsdt(fiat: string): Promise<number[]> {
  const res = await fetch("https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
    body: JSON.stringify({ fiat, page: 1, rows: 10, asset: "USDT", tradeType: "BUY", countries: [], payTypes: [] }),
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) return [];
  const json = (await res.json().catch(() => null)) as { data?: { adv?: { price?: string } }[] } | null;
  return (json?.data ?? []).map((d) => Number(d.adv?.price)).filter((p) => p > 0);
}

/**
 * A robust reference from a list of buy-USDT ads: the median of the whole set,
 * which sits right in the live cluster (~₦1,386) and ignores the odd low/high
 * outlier ad.
 */
function referenceFrom(prices: number[]): number | null {
  return median(prices);
}

/** Live USDT price in `currency` from P2P (Bybit → Binance), or null. Cached 2m. */
export async function p2pUsdtRate(currency: string): Promise<number | null> {
  const cur = currency.toUpperCase();
  const hit = cache.get(cur);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rate;

  try {
    const rate = referenceFrom(await bybitBuyUsdt(cur));
    if (rate && rate > 0) {
      cache.set(cur, { at: Date.now(), rate });
      return rate;
    }
  } catch {
    /* try Binance */
  }

  try {
    const rate = referenceFrom(await binanceBuyUsdt(cur));
    if (rate && rate > 0) {
      cache.set(cur, { at: Date.now(), rate });
      return rate;
    }
  } catch {
    /* fall through */
  }

  return hit?.rate ?? null; // serve stale rather than nothing
}
