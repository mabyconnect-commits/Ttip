/**
 * Live USDT↔fiat reference rate from P2P markets — the real "street"/parallel
 * rate (e.g. ~₦1,392/USDT) that sits well above the official FX rate.
 *
 * Primary source: Bybit P2P (the board Ttip tracks). Backup: Binance P2P. We take
 * a robust median of the best ads on each side and return the mid; our margin is
 * applied on top (buy = +margin, sell = −margin). Returns null if every source
 * fails, so the caller falls back to official FX.
 */

const cache = new Map<string, { at: number; rate: number }>();
const TTL_MS = 3 * 60 * 1000; // 3 minutes

function median(nums: number[]): number | null {
  const a = nums.filter((n) => Number.isFinite(n) && n > 0).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

// ---- Binance P2P ----
async function binanceSide(fiat: string, tradeType: "BUY" | "SELL"): Promise<number[]> {
  const res = await fetch("https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
    body: JSON.stringify({ fiat, page: 1, rows: 10, asset: "USDT", tradeType, countries: [], payTypes: [] }),
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) return [];
  const json = (await res.json().catch(() => null)) as { data?: { adv?: { price?: string } }[] } | null;
  return (json?.data ?? []).map((d) => Number(d.adv?.price)).filter((p) => p > 0);
}

// ---- Bybit P2P (backup) ----
async function bybitSide(currency: string, side: "0" | "1"): Promise<number[]> {
  const res = await fetch("https://api2.bybit.com/fiat/otc/item/online", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
    body: JSON.stringify({ tokenId: "USDT", currencyId: currency, payment: [], side, size: "10", page: "1", amount: "", authMaturity: "", itemRegion: 1 }),
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) return [];
  const json = (await res.json().catch(() => null)) as { result?: { items?: { price?: string }[] } } | null;
  return (json?.result?.items ?? []).map((i) => Number(i.price)).filter((p) => p > 0);
}

/** Mid of the best buy-side and sell-side ads, from the given side arrays. */
function midOf(buyPrices: number[], sellPrices: number[]): number | null {
  const buy = median(buyPrices.slice(0, 5)); // price to BUY USDT
  const sell = median(sellPrices.slice(0, 5)); // price to SELL USDT
  if (buy && sell) return (buy + sell) / 2;
  return buy ?? sell ?? null;
}

/** Live USDT price in `currency` from P2P (Binance → Bybit), or null. Cached. */
export async function p2pUsdtRate(currency: string): Promise<number | null> {
  const cur = currency.toUpperCase();
  const hit = cache.get(cur);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rate;

  // Bybit first. side "1" = sell ads (buy USDT price); "0" = buy ads (sell USDT price).
  try {
    const [sellAds, buyAds] = await Promise.all([bybitSide(cur, "1"), bybitSide(cur, "0")]);
    const rate = midOf(sellAds, buyAds);
    if (rate && rate > 0) {
      cache.set(cur, { at: Date.now(), rate });
      return rate;
    }
  } catch {
    /* try Binance */
  }

  // Binance backup.
  try {
    const [buy, sell] = await Promise.all([binanceSide(cur, "BUY"), binanceSide(cur, "SELL")]);
    const rate = midOf(buy, sell);
    if (rate && rate > 0) {
      cache.set(cur, { at: Date.now(), rate });
      return rate;
    }
  } catch {
    /* fall through */
  }

  return hit?.rate ?? null; // serve stale rather than nothing
}
