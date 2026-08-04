export interface UserSummary {
  id: string;
  email: string;
  username: string;
  name: string;
  verified: boolean;
  avatarGradient: string;
  defaultFiat: string;
  bankName: string | null;
  bankAccount: string | null;
  streakDays: number;
  points: number;
  freeSwapsLeft: number;
  referralCode: string;
  /** Claimable referral pot, in REWARDS_BASE_FIAT (not the display currency). */
  referralEarned: number;
  /** Claimable cashback, already converted into `defaultFiat`. */
  cashback: number;
  /** Claim threshold, in the same currency as `cashback`. */
  cashbackMin: number;
  hasPin: boolean;
  kycStatus: string;
  kycTier: number;
  nairaAccount?: string | null;
  nairaBank?: string | null;
  initial: string;
  /** Shows the admin link. Authorisation itself is always server-side. */
  isAdmin?: boolean;
}

export interface PortfolioAsset {
  symbol: string;
  kind: "crypto" | "fiat";
  name: string;
  color: string;
  glyph: string;
  amount: number;
  usdValue: number;
  fiatValue: number;
  change24h: number;
}

export interface Portfolio {
  fiat: string;
  totalUsd: number;
  totalFiat: number;
  assets: PortfolioAsset[];
}

export interface CardInfo {
  last4: string;
  holder: string;
  balanceUsd: number;
  frozen: boolean;
  exp: string;
}

export interface AppState {
  user: UserSummary;
  portfolio: Portfolio;
  card: CardInfo | null;
  config?: {
    payments: "live" | "demo" | "disabled";
    /** Deposit fee resolved on the server, so the quote matches the charge. */
    depositFee?: { pct: number; cap: number | null; flat?: number };
  };
  receipt?: any;
}

export interface PricePair {
  pair: string;
  value: number;
  change: number;
  fiat: string;
}
