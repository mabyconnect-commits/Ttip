import {
  KYC_TIERS,
  CASHBACK_PCT,
  CASHBACK_MIN_CLAIM,
  REFERRAL_EARN_PCT,
  SWAP_FEE_PCT,
  WITHDRAW_FEE_USDT,
  DEPOSIT_BONUS_NGN,
  DEPOSIT_BONUS_MIN_USD,
  DEPOSIT_BONUS_HOLD_HOURS,
} from "../constants";
import { providerTransferFee, transferFeeMarkup, billFee, depositFeeSchedule, collectionFeePct } from "../fees";
import { COLLECTION_FEE_PCT } from "../constants";
import { supportedPayoutCurrencies, comingSoonCurrencies } from "./knowledge";
import { COMPANY } from "../company";

/**
 * The assistant WITHOUT the model.
 *
 * Ada's smart answers need an Anthropic key. Support chat must not need one:
 * gating the whole feature on an environment variable meant that until it was
 * set there was no support chat at all, which is worse than a plain one.
 *
 * So these are deterministic answers to the questions people actually ask,
 * built from the SAME live constants the app charges with — so they can't drift
 * from the real fees any more than the model's answers can. When the key is
 * present the model takes over; when it isn't, this replies and offers a human.
 *
 * Dependency-free so it's unit-testable.
 */

export interface FaqAnswer {
  text: string;
  /** True when we couldn't answer and a human should take it. */
  escalate: boolean;
}

/** Personalisation the caller can supply from the signed-in user. */
export interface FaqContext {
  name?: string;
  tier?: number;
  kycStatus?: string;
  nairaAccount?: string | null;
  nairaBank?: string | null;
  bankAliases?: string[];
}

const money = (n: number) => "₦" + n.toLocaleString("en-US");

function feeLine(): string {
  const m = 1 + transferFeeMarkup();
  const up = (a: number) => Math.ceil(providerTransferFee(a, "NGN")! * m);
  return `${money(up(1000))} under ₦5,000, ${money(up(10000))} up to ₦50,000, ${money(up(100000))} above that`;
}

function tierLine(tier: number): string {
  const t = KYC_TIERS.find((x) => x.tier === tier) ?? KYC_TIERS[0];
  if (t.perTransferNgn <= 0) return "You can't withdraw yet — verify your BVN under Account → KYC first.";
  return `You're on Tier ${t.tier}: up to ${money(t.perTransferNgn)} per transfer and ${money(t.dailyNgn)} per rolling 24 hours.`;
}

function nextTier(tier: number): string {
  if (tier <= 0) return "Add your BVN under Account → KYC to unlock Tier 1.";
  if (tier === 1) return "Add a government ID — NIN, passport or driver's licence — under Account → KYC for Tier 2.";
  if (tier === 2) return "Add proof of address under Account → KYC for Tier 3.";
  return "You're already on the highest tier.";
}

interface Intent {
  /** Any of these phrases anywhere in the question triggers it. */
  match: string[];
  answer: (c: FaqContext) => string;
}

const INTENTS: Intent[] = [
  {
    match: ["cash out", "cashout", "withdraw to bank", "send to bank", "bank transfer", "payout", "withdraw money"],
    answer: () =>
      `Go to Send out → To bank. Pick the bank, enter the account number and we'll confirm the name before you send. ` +
      `Most payouts land in seconds. The transfer fee is ${feeLine()}. ` +
      `Payouts are available in ${supportedPayoutCurrencies().join(", ")}.`,
  },
  {
    match: [
      "cant withdraw",
      "cant i withdraw",
      "cannot withdraw",
      "why is my withdrawal",
      "limit",
      "limits",
      "how much can i send",
      "how much can i withdraw",
      "maximum",
    ],
    answer: (c) =>
      `${tierLine(c.tier ?? 0)} Limits are counted over a rolling 24 hours, not a calendar day, so they don't reset at midnight. ${nextTier(
        c.tier ?? 0,
      )}`,
  },
  {
    match: ["deposit", "add money", "fund my account", "account number", "top up", "topup"],
    answer: (c) => {
      const s = depositFeeSchedule("NGN", collectionFeePct("NGN", COLLECTION_FEE_PCT));
      const fee = `The deposit fee is ${(s.pct * 100).toFixed(1)}%${s.cap ? `, capped at ${money(s.cap)}` : ""}.`;
      if (c.nairaAccount) {
        const alt = c.bankAliases?.length ? ` Some bank apps list that bank as ${c.bankAliases.join(" or ")} — it's the same bank.` : "";
        return `Transfer to your dedicated account: ${c.nairaAccount} at ${c.nairaBank ?? "your partner bank"}.${alt} It credits automatically, usually in seconds. ${fee} You can also send crypto from Add money — just make sure the network matches.`;
      }
      return `Open Add money. Verify your BVN under Account → KYC and we'll issue you a dedicated naira account number to transfer to. ${fee} You can also deposit crypto — make sure you send on the right network.`;
    },
  },
  {
    match: ["cant find the bank", "bank not showing", "flutterwave mfb", "orokam", "ok mfb", "wrong bank name"],
    answer: (c) => {
      const alt = c.bankAliases?.length ? c.bankAliases.join(", ") : "OK MFB, Orokam Microfinance Bank";
      return `That's normal — the partner bank is listed under different names in different apps. Search for ${alt}. They're all the same bank, and your account is real. Don't search for "Ttip".`;
    },
  },
  {
    match: ["fee", "fees", "charge", "how much do you take", "cost"],
    answer: () =>
      `Bank transfer out: ${feeLine()}. Swaps: ${(SWAP_FEE_PCT * 100).toFixed(1)}%. ` +
      `Crypto withdrawal: a flat $${WITHDRAW_FEE_USDT.toFixed(2)} plus the network fee. ` +
      `Bills carry a small service fee, capped at ${money(billFee(1_000_000))}. Ttip transfers between users are free.`,
  },
  {
    match: ["kyc", "verify", "verification", "bvn", "nin", "tier"],
    answer: (c) => {
      const status = c.kycStatus === "verified" ? "Your account is verified." : c.kycStatus === "pending" ? "Your verification is in review." : "Your account isn't verified yet.";
      return `${status} ${tierLine(c.tier ?? 0)} ${nextTier(c.tier ?? 0)}`;
    },
  },
  {
    // "Can you help me do transfers?" — this used to escalate to email, which
    // is absurd for something the assistant can actually do.
    match: [
      "help me do transfers",
      "help me transfer",
      "can you transfer",
      "can you send money",
      "can you help me send",
      "do transfers",
      "can you buy airtime",
      "can you buy data",
      "what can you do for me",
    ],
    answer: () =>
      `Yes. Tell me the amount and who it's for and I'll set it up — you confirm with your PIN. ` +
      `Try "send ₦5,000 to my GTBank account", "buy me ₦100 airtime" or "send 1GB to my MTN line". ` +
      `I can only use accounts and lines you've used before, or a number you type yourself.`,
  },
  {
    match: ["cashback", "cash back"],
    answer: () =>
      `You earn ${(CASHBACK_PCT * 100).toFixed(2)}% back on every buy, sell and swap. Once it reaches ${money(
        CASHBACK_MIN_CLAIM,
      )} you can claim it from Account → Cashback and it goes straight into your balance.`,
  },
  {
    match: ["referral", "refer", "invite", "commission"],
    answer: () =>
      `You earn ${(REFERRAL_EARN_PCT * 100).toFixed(0)}% of the platform revenue on everything the people you invite do — ongoing, not a one-off. ` +
      `They get ${money(DEPOSIT_BONUS_NGN)} once their first deposit of $${DEPOSIT_BONUS_MIN_USD} or more has stayed on Ttip for ${DEPOSIT_BONUS_HOLD_HOURS} hours. Your link is under Referrals.`,
  },
  {
    match: ["airtime", "data", "electricity", "bill", "tv", "dstv", "gotv", "meter", "recharge"],
    answer: () =>
      `Open Bills and pick the category — Airtime, Data, Electricity, TV or Internet. Bills are always priced in naira whatever your display currency, ` +
      `and the service fee is shown before you confirm. If a payment shows as processing it's with the biller; you'll be notified when it lands.`,
  },
  {
    match: ["swap", "convert", "exchange"],
    answer: () =>
      `Open Swap, choose what you're converting from and to, and you'll see the rate and what you'll receive before confirming. ` +
      `Crypto-to-crypto swaps carry a ${(SWAP_FEE_PCT * 100).toFixed(1)}% fee; crypto-to-cash is priced in the rate.`,
  },
  {
    match: ["send crypto", "wallet address", "withdraw crypto", "network", "trc20", "erc20"],
    answer: () =>
      `Send out → To wallet. Pick the network and asset, paste the address, and check the preview of what actually arrives. ` +
      `Our fee is a flat $${WITHDRAW_FEE_USDT.toFixed(2)} plus the network's own fee. Sending on the wrong network can lose the funds permanently, so check it twice.`,
  },
  {
    match: [
      "send to a friend",
      "send money to a friend",
      "send money to someone",
      "tip someone",
      "tip a friend",
      "send to a username",
      "ttip someone",
      "ttip a friend",
    ],
    answer: () =>
      `Tap Ttip, enter their @username and the amount — instant and free. If they're not on Ttip yet, the money waits for them to join with that handle. ` +
      `For a bank account, just tell me the amount and who, like "send ₦5,000 to my GTBank account", and I'll set it up for you to confirm with your PIN.`,
  },
  {
    match: [
      "what is ttip",
      "whats ttip",
      "what is this app",
      "what does ttip do",
      "how does ttip work",
      "about ttip",
      "all about",
      "tell me about ttip",
      "what can i do here",
      "what can you do",
    ],
    answer: () =>
      `${COMPANY.product} turns crypto into spendable cash across Africa. You can deposit crypto or naira, ` +
      `buy and sell BTC, ETH, USDT and more, swap between them, and cash out straight to your bank in seconds. ` +
      `You can also pay bills — airtime, data, electricity, TV, internet — send money instantly to another ` +
      `${COMPANY.product} user by @username, and earn cashback on every trade plus ${(REFERRAL_EARN_PCT * 100).toFixed(0)}% of the fees from ` +
      `anyone you invite. Payouts run in ${supportedPayoutCurrencies().join(", ")}.`,
  },
  {
    match: ["pending", "not received", "hasnt arrived", "still processing", "where is my money", "missing"],
    answer: () =>
      `Pending means it's left your balance and is with the bank or the provider. Most clear in seconds, but bank downtime can add minutes. ` +
      `Open Account → Transactions, tap the payment and quote the reference to us if it's been longer than that.`,
  },
  {
    match: ["card", "virtual card"],
    answer: () => `Virtual cards are coming soon — we can't issue one yet. Everything else on your account works normally.`,
  },
  {
    match: ["currency", "supported countries", "which countries", "cedis", "rand", "shilling"],
    answer: () =>
      `Bank payouts work in ${supportedPayoutCurrencies().join(", ")}. ${comingSoonCurrencies().join(", ")} can be displayed but not cashed out to a bank yet.`,
  },
  {
    match: ["password", "forgot my password", "reset password", "cant log in"],
    answer: () => `Tap "Forgot your password?" on the sign-in screen and we'll email you a reset link. It's single-use and expires in 30 minutes.`,
  },
  {
    match: ["pin", "app lock", "security", "2fa"],
    answer: () => `Set or change your transaction PIN and app lock under Account → Security. We will never ask you for your PIN, password, BVN or OTP — anyone who does is scamming you.`,
  },
  {
    match: ["hello", "hi", "hey", "good morning", "good afternoon", "good evening"],
    answer: (c) => {
      // Skip a one- or two-letter first name — it's usually a title ("Mr"),
      // and "Hi Mr" reads worse than no name at all.
      const first = (c.name ?? "").trim().split(/\s+/)[0] ?? "";
      const greet = first.length >= 3 ? ` ${first}` : "";
      return `Hi${greet} — what can I help you with? Fees, limits, deposits, payouts, bills, referrals: ask away.`;
    },
  },
];

/** Answer a question deterministically, or say we can't and offer a human. */
/**
 * Lowercase, strip apostrophes and collapse whitespace, so "why can't I
 * withdraw" and "why cant i withdraw" are the same question. Match phrases are
 * written in this normalised form.
 */
function normalize(s: string): string {
  return (s ?? "").toLowerCase().replace(/['\u2019]/g, "").replace(/\s+/g, " ").trim();
}

/** Escape a phrase for use inside a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whole-word match. Substring matching sent "Whats Ttip all about?" to the
 * peer-to-peer transfer answer, because the brand name appears in almost every
 * question anyone asks. A phrase now has to sit on word boundaries.
 */
function mentions(q: string, phrase: string): boolean {
  return new RegExp(`(^|\\W)${escapeRe(phrase)}($|\\W)`).test(q);
}

export function answerFaq(question: string, ctx: FaqContext = {}): FaqAnswer {
  const q = normalize(question);
  if (!q) return { text: "Ask me anything about Ttip.", escalate: false };

  // Longest matching phrase wins, so "cant withdraw" beats a bare "withdraw".
  let best: { intent: Intent; len: number } | null = null;
  for (const intent of INTENTS) {
    for (const phrase of intent.match) {
      if (mentions(q, phrase) && (!best || phrase.length > best.len)) {
        best = { intent, len: phrase.length };
      }
    }
  }

  if (best) return { text: best.intent.answer(ctx), escalate: false };

  return {
    text:
      `I'm not sure about that one, and I'd rather not guess when it's about your money. ` +
      `The team can pick it up from here — email ${COMPANY.supportEmail} and they'll get back to you.`,
    escalate: true,
  };
}
