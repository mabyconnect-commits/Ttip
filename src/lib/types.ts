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
  referralEarned: number;
  cashback: number;
  hasPin: boolean;
  kycStatus: string;
  kycTier: number;
  nairaAccount?: string | null;
  nairaBank?: string | null;
  initial: string;
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
  config?: { payments: "live" | "demo" | "disabled" };
  receipt?: any;
}

export interface PricePair {
  pair: string;
  value: number;
  change: number;
  fiat: string;
}
