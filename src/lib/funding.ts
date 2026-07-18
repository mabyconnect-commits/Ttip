interface FundAsset {
  symbol: string;
  amount: number;
  usdValue: number;
}

/**
 * Pick which asset should fund a spend (tip, bill). Prefers USDT when held,
 * otherwise the user's most valuable holding — so someone who only holds BTC or
 * has cashed out to Naira can still pay, instead of being told "no USDT".
 */
export function pickFunding(assets: FundAsset[], fallback = "USDT"): string {
  const held = assets.filter((a) => a.amount > 0).sort((a, b) => b.usdValue - a.usdValue);
  if (held.some((a) => a.symbol === "USDT")) return "USDT";
  return held[0]?.symbol ?? fallback;
}
