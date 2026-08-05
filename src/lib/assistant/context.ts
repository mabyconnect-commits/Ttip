import "server-only";
import { prisma } from "../db";
import { kycTierDef } from "../constants";
import { bankAliases } from "../bank-aliases";
import { spendableFiat } from "../spendable";
import { liveRates } from "../live-rates";

/**
 * The account snapshot Ada is given about the person she's talking to.
 *
 * This is the difference between a FAQ bot and a useful one: "why can't I
 * withdraw ₦300,000?" has a real answer only if she can see the user is Tier 1
 * with a ₦100,000 per-transfer cap.
 *
 * Two rules govern what goes in here:
 *
 *  1. NOTHING the user can't already see in their own app. No password or PIN
 *     hashes, no BVN, no other users' data, no internal ids beyond a public
 *     transaction reference. The model only ever learns what the account holder
 *     already knows.
 *
 *  2. It is loaded for the SIGNED-IN user id from the session cookie — never
 *     from anything the client sends — so a crafted request can't ask about
 *     someone else's account.
 */

const RECENT_LIMIT = 8;

export async function buildUserContext(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { balances: true },
  });
  if (!user) return "";

  const tier = kycTierDef(user.kycTier ?? 0);

  // The user's own crypto deposit addresses.
  //
  // Ada could see the naira account but not these, so "send me my wallet
  // addresses" — one of the most obvious things to ask an assistant that can
  // see your account — got an answer about opening the Deposit screen. They're
  // the user's own, and already printed on that screen, so there is nothing
  // here they can't already read.
  const addresses = await prisma.walletAddress.findMany({
    where: { userId },
    orderBy: [{ symbol: "asc" }, { network: "asc" }],
    take: 40,
    select: { symbol: true, network: true, address: true },
  });

  const recent = await prisma.transaction.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: RECENT_LIMIT,
    select: {
      id: true,
      type: true,
      status: true,
      assetIn: true,
      amountIn: true,
      assetOut: true,
      amountOut: true,
      createdAt: true,
    },
  });

  const holdings = user.balances
    .filter((b) => Number(b.amount) > 0)
    .map((b) => `${trim(Number(b.amount))} ${b.symbol}`)
    .join(", ");

  /**
   * What those holdings are worth to spend, together.
   *
   * Without this, Ada reads "0.67 USDT, no naira" and concludes the user must
   * swap to naira before sending — which is wrong, and which the app has never
   * required: a payout is funded from every wallet at once. Giving her the one
   * number the funding actually uses is what stops her inventing that advice.
   */
  const money = await spendableFiat(user.balances, user.defaultFiat).catch(() => null);

  /**
   * Today's prices — the same table the Rates screen draws.
   *
   * "If I send 1 ETH now, how much naira do I get?" is the single most common
   * question anyone asks a wallet, and Ada was answering "I can't quote you a
   * live ETH rate, I don't have one in front of me" while the app displayed it
   * two taps away. She was right to refuse to guess; she just should never have
   * had to. Now she can answer it, in her user's own currency.
   */
  const rates = await liveRates(user.defaultFiat).catch(() => []);

  const aliases = bankAliases(user.nairaBank);

  const lines: string[] = [
    `Name: ${user.name} (@${user.username})`,
    `Display currency: ${user.defaultFiat}`,
    `KYC: ${user.kycStatus} — Tier ${tier.tier} (${tier.name}). ${
      tier.perTransferNgn > 0
        ? `Limits: ₦${tier.perTransferNgn.toLocaleString()} per transfer, ₦${tier.dailyNgn.toLocaleString()} per rolling 24h.`
        : "Cannot withdraw until verified."
    }`,
    `Next step to raise limits: ${nextStep(tier.tier)}`,
    `Deposit account: ${
      user.nairaAccount
        ? `${user.nairaAccount} · ${user.nairaBank ?? "partner bank"}${
            aliases.length ? ` (also listed as ${aliases.join(", ")})` : ""
          }`
        : "not provisioned yet — verify BVN under Account → KYC"
    }`,
    `Transaction PIN set: ${user.pinHash ? "yes" : "no"}`,
    `Holdings: ${holdings || "empty"}`,
    money
      ? `Spendable on a ${money.fiat} payout — the app funds one from ALL of these together, ` +
        `converting as it sends, so the user NEVER has to swap to ${money.fiat} first:\n` +
        money.wallets
          .map((w) => `  ${trim(w.amount)} ${w.symbol} ≈ ${money.fiat} ${trim(w.fiat)}`)
          .join("\n") +
        `\n  TOTAL ≈ ${money.fiat} ${trim(money.total)} (at today's sell rate, before the transfer fee). ` +
        `Judge "can they afford it" against this total plus the fee, never against one wallet.`
      : `Spendable total: unavailable right now — do not guess whether they can afford something.`,
    rates.length
      ? `TODAY'S TTIP RATES in ${user.defaultFiat}, per 1 unit — these are live and they are OURS ` +
        `(our margin is already inside them; never itemise it). SELL is what the user RECEIVES ` +
        `when turning that asset into ${user.defaultFiat}; BUY is what they PAY for one. ` +
        `Quote these when asked what something is worth — multiply out for the amount they named ` +
        `and give the figure. Add that it moves with the market and the exact number is shown ` +
        `before they confirm, but DO answer:\n` +
        rates
          .map((r) => `  1 ${r.symbol}: sell ${trim(r.sell)} / buy ${trim(r.buy)} ${user.defaultFiat}`)
          .join("\n")
      : `Today's rates: unavailable right now — say the rate service is down and the exact figure ` +
        `is quoted on the Send out screen. Do not guess a price.`,
    addresses.length
      ? `Crypto deposit addresses (their own — quote these EXACTLY, never alter a character, and always name the network alongside):\n` +
        addresses.map((a) => `  ${a.symbol} on ${a.network}: ${a.address}`).join("\n")
      : `Crypto deposit addresses: none generated yet — they appear on Add money once an asset and network are picked.`,
    `Cashback pot: ${trim(Number(user.cashback))} (base currency) · Referral earned: ${trim(
      Number(user.referralEarned),
    )} (base currency)`,
  ];

  if (recent.length) {
    lines.push("Recent activity (newest first):");
    for (const t of recent) {
      const inPart = t.assetIn ? `${trim(Number(t.amountIn ?? 0))} ${t.assetIn}` : "";
      const outPart = t.assetOut ? `${trim(Number(t.amountOut ?? 0))} ${t.assetOut}` : "";
      const flow = [inPart, outPart].filter(Boolean).join(" → ");
      lines.push(
        `  ${t.createdAt.toISOString().slice(0, 16).replace("T", " ")} · ${t.type} · ${t.status}${
          flow ? ` · ${flow}` : ""
        } · ref ${t.id.slice(-8).toUpperCase()}`,
      );
    }
  }

  return `# The signed-in user

Everything below is this user's own account, as of right now. Use it to answer
their questions directly. Do not read it out wholesale — refer to the parts that
answer what they asked. A "pending" item is still in flight; you do not know
whether it will complete, so never promise an outcome.

${lines.join("\n")}`;
}

function nextStep(tier: number): string {
  if (tier <= 0) return "verify BVN under Account → KYC (unlocks Tier 1)";
  if (tier === 1) return "add a government ID — NIN, passport or driver's licence (unlocks Tier 2)";
  if (tier === 2) return "add proof of address (unlocks Tier 3)";
  return "already on the highest tier";
}

/** Compact number for the prompt: no trailing zero noise, no scientific notation. */
function trim(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n) >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return n.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
}
