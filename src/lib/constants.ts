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

// Naira is the primary market; the rest let Ttip expand across Africa. Every
// currency here is priced live off the USD pivot (see getFiatRates), so it is
// safe to hold, display and swap.
//
// Bank PAYOUTS are a narrower set — see settlement/payout-country.ts. A currency
// listed here is not automatically payable, and one that isn't mapped there is
// refused at payout rather than being sent to the wrong country's banks.
export const FIATS: Fiat[] = [
  { code: "NGN", name: "Nigerian Naira", symbol: "₦", flag: "🇳🇬", country: "Nigeria" },
  { code: "GHS", name: "Ghanaian Cedi", symbol: "₵", flag: "🇬🇭", country: "Ghana" },
  { code: "KES", name: "Kenyan Shilling", symbol: "KSh", flag: "🇰🇪", country: "Kenya" },
  { code: "ZAR", name: "South African Rand", symbol: "R", flag: "🇿🇦", country: "South Africa" },
  { code: "XOF", name: "West African CFA Franc", symbol: "CFA", flag: "🌍", country: "West Africa" },
  { code: "XAF", name: "Central African CFA Franc", symbol: "FCFA", flag: "🌍", country: "Central Africa" },
  { code: "UGX", name: "Ugandan Shilling", symbol: "USh", flag: "🇺🇬", country: "Uganda" },
  { code: "TZS", name: "Tanzanian Shilling", symbol: "TSh", flag: "🇹🇿", country: "Tanzania" },
  { code: "RWF", name: "Rwandan Franc", symbol: "FRw", flag: "🇷🇼", country: "Rwanda" },
  { code: "ZMW", name: "Zambian Kwacha", symbol: "ZK", flag: "🇿🇲", country: "Zambia" },
  { code: "EGP", name: "Egyptian Pound", symbol: "E£", flag: "🇪🇬", country: "Egypt" },
  { code: "MAD", name: "Moroccan Dirham", symbol: "DH", flag: "🇲🇦", country: "Morocco" },
  { code: "ETB", name: "Ethiopian Birr", symbol: "Br", flag: "🇪🇹", country: "Ethiopia" },
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
  XOF: 1 / 605,
  XAF: 1 / 605,
  UGX: 1 / 3700,
  TZS: 1 / 2550,
  RWF: 1 / 1300,
  ZMW: 1 / 27,
  EGP: 1 / 49,
  MAD: 1 / 9.9,
  ETB: 1 / 125,
};

// Fallback USD prices if the live price feed is unavailable.
export const FALLBACK_USD_PRICE: Record<string, number> = {
  BTC: 92000, ETH: 3300, USDT: 1, USDC: 1, SOL: 212,
  BNB: 610, XRP: 0.62, ADA: 0.58, DOGE: 0.14, TRX: 0.16,
  MATIC: 0.52, LTC: 92, DOT: 6.4, AVAX: 34, TON: 5.4,
};

// Consumer bill categories surfaced in the app. Providers and plans are loaded
// dynamically from the biller catalog (Flutterwave live, static in demo), so only
// the id/title/icon and the amount presets for variable-amount categories live
// here. Airtime & electricity are variable-amount; data/tv/internet are plans.
export const BILL_CATEGORIES = [
  { id: "airtime", title: "Airtime", icon: "📞", amounts: [100, 200, 500, 1000] },
  { id: "data", title: "Data", icon: "📶", amounts: [] },
  { id: "electricity", title: "Electricity", icon: "💡", amounts: [1000, 2000, 5000, 10000] },
  { id: "tv", title: "TV / Cable", icon: "📺", amounts: [] },
  { id: "internet", title: "Internet", icon: "🌐", amounts: [] },
] as const;

/**
 * KYC tiers — the single source of truth for both the limits screen and the
 * server-side enforcement, so what a user is shown is exactly what is applied.
 *
 * The ladder is what each step of identity actually proves:
 *   1  BVN — confirms the person is bank-verified. Regular starter limits.
 *   2  BVN + any government ID (NIN, passport, driver's licence).
 *   3  Tier 2 + proof of address.
 *
 * Limits are naira amounts; a payout in another currency is converted to naira
 * before it's checked, so one ladder governs every currency.
 */
export interface KycTierDef {
  tier: number;
  name: string;
  /** Max total withdrawn per rolling day, in NGN. 0 = cannot withdraw. */
  dailyNgn: number;
  /** Max single withdrawal, in NGN. 0 = cannot withdraw. */
  perTransferNgn: number;
  requires: string;
}

export const KYC_TIERS: KycTierDef[] = [
  { tier: 0, name: "Unverified", dailyNgn: 0, perTransferNgn: 0, requires: "Email only — verify your BVN to withdraw" },
  { tier: 1, name: "Starter", dailyNgn: 500_000, perTransferNgn: 100_000, requires: "BVN verified" },
  { tier: 2, name: "Verified", dailyNgn: 5_000_000, perTransferNgn: 2_000_000, requires: "BVN + a government ID (NIN, passport or driver's licence)" },
  { tier: 3, name: "Pro", dailyNgn: 50_000_000, perTransferNgn: 10_000_000, requires: "BVN + government ID + proof of address" },
];

/** The limits for a tier, clamped to the range we define. */
export function kycTierDef(tier: number): KycTierDef {
  return KYC_TIERS.find((t) => t.tier === tier) ?? KYC_TIERS[0];
}

/** ID types that count as a government ID for Tier 2 (BVN is separate). */
export const GOVERNMENT_ID_TYPES = ["nin", "passport", "drivers_license"] as const;

export const SWAP_FEE_PCT = 0.009; // 0.9% after free swaps used
export const NETWORK_FEE_USDT = 1; // flat network fee on external sends (USDT-equivalent)

// Ttip's flat platform fee on a crypto withdrawal — charged ON TOP of the real
// on-chain/provider fee (which the provider already deducts and we show as
// "recipient gets"). So the total a user pays is: actual network fee + this.
export const WITHDRAW_FEE_USDT = 0.5; // $0.50 flat, nothing more

// The spread Ttip keeps on crypto↔fiat conversion. The user is quoted the live
// market/P2P reference rate minus this margin; the difference is platform
// revenue. Keep it tight to stay competitive with Bybit P2P. Override per
// deploy with PLATFORM_MARGIN_PCT.
export const PLATFORM_MARGIN_PCT = 0.018; // 1.8% — buy = +1.8%, sell = −1.8% of the Bybit reference

// What the fiat collection provider (Flutterwave) takes on a buy. We credit
// crypto on the amount NET of this fee so the fee never eats our margin.
// Override with COLLECTION_FEE_PCT.
export const COLLECTION_FEE_PCT = 0.015; // 1.5%

// Cashback: users earn this fraction of every buy/sell back into a separate
// cashback balance, claimable once it reaches CASHBACK_MIN_CLAIM.
export const CASHBACK_PCT = 0.001; // 0.1%
export const CASHBACK_MIN_CLAIM = 5000; // ₦5,000

// The reward pots (user.cashback, user.referralEarned) and the reward
// thresholds below are bare numbers with no currency column, so they are all
// denominated in THIS currency no matter what the user is displaying. Anything
// crossing the boundary must convert — see src/lib/rewards.ts. Changing this
// requires migrating both pots.
export const REWARDS_BASE_FIAT = "NGN";

// The bill catalog (biller codes, plan prices, quick amounts) is Nigerian, so a
// bill is always priced and paid in naira regardless of the display currency.
export const BILL_FIAT = "NGN";

// Referrals: a referrer earns this share of the platform revenue (fees + spread)
// on every transaction their referred users make — an ongoing lifetime cut, not
// a one-off. Override with REFERRAL_EARN_PCT.
export const REFERRAL_EARN_PCT = 0.25; // 25% of a downline's SWAP + CRYPTO-WITHDRAWAL fees

// First-deposit bonus: a referred user earns this once, HOLD hours after their
// first deposit worth at least MIN_USD — but only if they still hold that value
// (they kept it on Ttip rather than cashing straight out).
export const DEPOSIT_BONUS_NGN = 500; // ₦500
export const DEPOSIT_BONUS_MIN_USD = 10; // first $10+ deposit
export const DEPOSIT_BONUS_HOLD_HOURS = 72; // must stay 72h
