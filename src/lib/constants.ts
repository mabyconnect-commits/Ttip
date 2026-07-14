// Catalog of supported assets, fiats, networks and providers.

export type CryptoSymbol =
  | "BTC" | "ETH" | "USDT" | "USDC" | "SOL"
  | "BNB" | "XRP" | "ADA" | "DOGE" | "TRX"
  | "MATIC" | "LTC" | "DOT" | "AVAX" | "TON";

export interface CryptoAsset {
  symbol: CryptoSymbol;
  name: string;
  color: string;
  glyph: string;
  coingeckoId: string;
  networks: { id: string; label: string; short: string }[];
}

export const CRYPTO_ASSETS: CryptoAsset[] = [
  { symbol: "USDT", name: "Tether", color: "#26A17B", glyph: "₮", coingeckoId: "tether", networks: [
    { id: "trc20", label: "TRC-20 (Tron)", short: "TRC-20" },
    { id: "erc20", label: "ERC-20 (Ethereum)", short: "ERC-20" },
    { id: "bep20", label: "BEP-20 (BNB)", short: "BEP-20" },
  ] },
  { symbol: "USDC", name: "USD Coin", color: "#2775CA", glyph: "$", coingeckoId: "usd-coin", networks: [
    { id: "erc20", label: "ERC-20 (Ethereum)", short: "ERC-20" },
    { id: "sol", label: "Solana", short: "SOL" },
  ] },
  { symbol: "BTC", name: "Bitcoin", color: "#F7931A", glyph: "₿", coingeckoId: "bitcoin", networks: [
    { id: "btc", label: "Bitcoin", short: "BTC" },
  ] },
  { symbol: "ETH", name: "Ethereum", color: "#627EEA", glyph: "Ξ", coingeckoId: "ethereum", networks: [
    { id: "erc20", label: "ERC-20 (Ethereum)", short: "ERC-20" },
  ] },
  { symbol: "SOL", name: "Solana", color: "#14F195", glyph: "◎", coingeckoId: "solana", networks: [
    { id: "sol", label: "Solana", short: "SOL" },
  ] },
  { symbol: "BNB", name: "BNB", color: "#F3BA2F", glyph: "⬡", coingeckoId: "binancecoin", networks: [{ id: "bep20", label: "BEP-20 (BNB)", short: "BEP-20" }] },
  { symbol: "XRP", name: "XRP", color: "#23292F", glyph: "✕", coingeckoId: "ripple", networks: [{ id: "xrp", label: "XRP Ledger", short: "XRP" }] },
  { symbol: "ADA", name: "Cardano", color: "#0033AD", glyph: "₳", coingeckoId: "cardano", networks: [{ id: "ada", label: "Cardano", short: "ADA" }] },
  { symbol: "DOGE", name: "Dogecoin", color: "#C2A633", glyph: "Ð", coingeckoId: "dogecoin", networks: [{ id: "doge", label: "Dogecoin", short: "DOGE" }] },
  { symbol: "TRX", name: "Tron", color: "#EF0027", glyph: "T", coingeckoId: "tron", networks: [{ id: "trc20", label: "TRC-20 (Tron)", short: "TRC-20" }] },
  { symbol: "MATIC", name: "Polygon", color: "#8247E5", glyph: "⬢", coingeckoId: "matic-network", networks: [{ id: "poly", label: "Polygon", short: "MATIC" }] },
  { symbol: "LTC", name: "Litecoin", color: "#345D9D", glyph: "Ł", coingeckoId: "litecoin", networks: [{ id: "ltc", label: "Litecoin", short: "LTC" }] },
  { symbol: "DOT", name: "Polkadot", color: "#E6007A", glyph: "●", coingeckoId: "polkadot", networks: [{ id: "dot", label: "Polkadot", short: "DOT" }] },
  { symbol: "AVAX", name: "Avalanche", color: "#E84142", glyph: "▲", coingeckoId: "avalanche-2", networks: [{ id: "avax", label: "Avalanche C-Chain", short: "AVAX" }] },
  { symbol: "TON", name: "Toncoin", color: "#0098EA", glyph: "◈", coingeckoId: "the-open-network", networks: [{ id: "ton", label: "TON", short: "TON" }] },
];

export const CRYPTO_BY_SYMBOL: Record<string, CryptoAsset> = Object.fromEntries(
  CRYPTO_ASSETS.map((a) => [a.symbol, a]),
);

export interface Fiat {
  code: string;
  name: string;
  symbol: string;
  flag: string;
  country: string;
}

export const FIATS: Fiat[] = [
  { code: "NGN", name: "Nigerian Naira", symbol: "₦", flag: "🇳🇬", country: "Nigeria" },
  { code: "GHS", name: "Ghanaian Cedi", symbol: "₵", flag: "🇬🇭", country: "Ghana" },
  { code: "KES", name: "Kenyan Shilling", symbol: "KSh", flag: "🇰🇪", country: "Kenya" },
  { code: "ZAR", name: "South African Rand", symbol: "R", flag: "🇿🇦", country: "South Africa" },
  { code: "USD", name: "US Dollar", symbol: "$", flag: "🇺🇸", country: "United States" },
];

export const FIAT_BY_CODE: Record<string, Fiat> = Object.fromEntries(FIATS.map((f) => [f.code, f]));

// USD per 1 unit of fiat (approx). USD is the pivot for all conversions.
// These are indicative reference rates; a production build wires a licensed FX/liquidity provider.
export const FIAT_USD_RATE: Record<string, number> = {
  USD: 1,
  NGN: 1 / 1642,
  GHS: 1 / 15.1,
  KES: 1 / 129.1,
  ZAR: 1 / 18.3,
};

// Fallback USD prices if the live price feed is unavailable.
export const FALLBACK_USD_PRICE: Record<string, number> = {
  BTC: 92000, ETH: 3300, USDT: 1, USDC: 1, SOL: 212,
  BNB: 610, XRP: 0.62, ADA: 0.58, DOGE: 0.14, TRX: 0.16,
  MATIC: 0.52, LTC: 92, DOT: 6.4, AVAX: 34, TON: 5.4,
};

export const BILL_CATEGORIES = [
  { id: "airtime", title: "Airtime", icon: "📞", providers: ["MTN", "Airtel", "Glo", "9mobile"], amounts: [500, 1000, 2000, 5000] },
  { id: "data", title: "Data", icon: "📶", providers: ["MTN", "Airtel", "Glo", "9mobile"], amounts: [1000, 2500, 5000, 10000] },
  { id: "electricity", title: "Electricity", icon: "💡", providers: ["EKEDC", "IKEDC", "AEDC", "PHED"], amounts: [2000, 5000, 10000, 20000] },
  { id: "tv", title: "TV / Cable", icon: "📺", providers: ["DStv", "GOtv", "Startimes"], amounts: [2950, 5300, 8400, 24500] },
  { id: "betting", title: "Betting", icon: "🎯", providers: ["Bet9ja", "SportyBet", "1xBet"], amounts: [1000, 2000, 5000, 10000] },
  { id: "internet", title: "Internet", icon: "🌐", providers: ["Spectranet", "Smile", "Swift"], amounts: [5000, 10000, 15000, 20000] },
] as const;

export const SWAP_FEE_PCT = 0.005; // 0.5% after free swaps used
export const NETWORK_FEE_USDT = 1; // flat network fee on external sends (USDT-equivalent)
