/**
 * Reading a crypto address out of a message, or off a QR code.
 *
 * Crypto is the one transfer with no recall, no provider to phone and no name
 * to check against — a wrong address is simply gone. So this is deliberately
 * strict: it recognises the shapes it is certain about and returns nothing for
 * everything else, because "I don't know which chain this is" must become a
 * question, never a guess.
 *
 * Dependency-free so it can be unit-tested.
 */

export type ChainFamily = "evm" | "solana" | "tron" | "bitcoin";

export interface CryptoAddress {
  address: string;
  family: ChainFamily;
  /** Set when a payment URI named the asset, e.g. "bitcoin:bc1…". */
  asset?: string;
  /** Set when a payment URI carried an amount, e.g. "?amount=0.5". */
  amount?: number;
}

/** EVM: 0x + 40 hex. */
const EVM = /\b(0x[a-fA-F0-9]{40})\b/;
/** Tron: T + 33 base58. */
const TRON = /\b(T[1-9A-HJ-NP-Za-km-z]{33})\b/;
/** Bitcoin: bech32 (bc1…) or legacy base58 (1…/3…). */
const BTC_BECH32 = /\b(bc1[02-9ac-hj-np-z]{11,71})\b/;
const BTC_LEGACY = /\b([13][1-9A-HJ-NP-Za-km-z]{25,34})\b/;
/** Solana: 32–44 base58, no 0/O/I/l. */
const SOLANA = /\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/;

/** Schemes a wallet QR normally uses. */
const URI = /^(bitcoin|ethereum|tron|solana|litecoin|ton):([^?\s]+)(\?[^\s]*)?/i;

const URI_FAMILY: Record<string, ChainFamily> = {
  bitcoin: "bitcoin",
  ethereum: "evm",
  tron: "tron",
  solana: "solana",
};

/**
 * Pull an address out of arbitrary text — a pasted string, a caption, or the
 * payload decoded from a QR code.
 *
 * Order matters. Tron and Bitcoin-legacy addresses are also valid base58 of
 * Solana's length, so the narrower patterns are tried first; anything still
 * matching afterwards is Solana.
 */
export function parseCryptoAddress(text: string): CryptoAddress | null {
  const raw = (text ?? "").trim();
  if (!raw) return null;

  // A payment URI is the most reliable form: it names its own chain.
  const uri = raw.match(URI);
  if (uri) {
    const scheme = uri[1].toLowerCase();
    const family = URI_FAMILY[scheme];
    const address = uri[2];
    if (family && address) {
      const amountMatch = (uri[3] ?? "").match(/[?&]amount=([0-9]*\.?[0-9]+)/i);
      const amount = amountMatch ? Number(amountMatch[1]) : undefined;
      // Still check the address against its family — a URI can lie about it.
      const checked = classify(address);
      if (checked && checked.family === family) {
        return { address, family, amount: amount && amount > 0 ? amount : undefined };
      }
      return null;
    }
    return null;
  }

  const evm = raw.match(EVM);
  if (evm) return { address: evm[1], family: "evm" };

  const tron = raw.match(TRON);
  if (tron) return { address: tron[1], family: "tron" };

  const bech = raw.match(BTC_BECH32);
  if (bech) return { address: bech[1], family: "bitcoin" };

  const legacy = raw.match(BTC_LEGACY);
  if (legacy) return { address: legacy[1], family: "bitcoin" };

  const sol = raw.match(SOLANA);
  if (sol) return { address: sol[1], family: "solana" };

  return null;
}

/** The family of a bare address string, or null when it isn't one we know. */
export function classify(address: string): CryptoAddress | null {
  const a = (address ?? "").trim();
  if (!a) return null;
  if (/^0x[a-fA-F0-9]{40}$/.test(a)) return { address: a, family: "evm" };
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a)) return { address: a, family: "tron" };
  if (/^bc1[02-9ac-hj-np-z]{11,71}$/.test(a)) return { address: a, family: "bitcoin" };
  if (/^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(a)) return { address: a, family: "bitcoin" };
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) return { address: a, family: "solana" };
  return null;
}

/**
 * The assets we can send on each family, best first.
 *
 * Used to work out what the user probably meant when they name an amount but
 * not an asset. If they hold exactly one of these, that's the answer; if they
 * hold several, we ask rather than pick.
 */
export const FAMILY_ASSETS: Record<ChainFamily, string[]> = {
  evm: ["USDT", "USDC", "ETH", "BNB"],
  solana: ["SOL", "USDC", "USDT"],
  tron: ["USDT"],
  bitcoin: ["BTC"],
};

/**
 * A human name for the network, for the confirmation.
 *
 * `evm` deliberately has no entry: one 0x address is valid on Ethereum,
 * Arbitrum, Base, Polygon, BNB Chain and every other EVM rail, and they are
 * different chains holding different money. This map used to answer "Ethereum"
 * for all of them, so "send 9.34 USDT to this Arbitrum wallet" was confirmed as
 * an Ethereum send — the one chain the user hadn't asked for. Use
 * `networkFor(family, text)` instead, which reads the chain the user named.
 */
export const FAMILY_NETWORK: Record<Exclude<ChainFamily, "evm">, string> = {
  solana: "Solana",
  tron: "Tron",
  bitcoin: "Bitcoin",
};

/**
 * The EVM chains we can send on, and the ways people write them.
 *
 * Every label here must be one `chainIdForNetwork` (lib/chains.ts) resolves, or
 * the send is refused at the last step for a chain we told the user we'd use.
 *
 * Order is the resolution order, and it matters: the specific chains come
 * FIRST, Ethereum last. "Send ETH to this Arbitrum wallet" names an asset that
 * sounds like a chain, and the chain the user actually named has to win.
 */
export const EVM_CHAINS: { label: string; match: RegExp }[] = [
  // "Arbitruim" is a real user's spelling. Anything starting "arbitr" is one
  // chain and nothing else, so the loose tail costs nothing and catches typos.
  { label: "Arbitrum", match: /\barbitr[a-z]*\b|\barb\b/i },
  { label: "Base", match: /\bbase(?:\s*chain|\s*network)?\b/i },
  { label: "Polygon", match: /\bpolygon\b|\bmatic\b/i },
  { label: "Optimism", match: /\boptimism\b|\bop\s*mainnet\b/i },
  { label: "BNB Chain", match: /\bbnb(?:\s*(?:smart\s*)?chain)?\b|\bbsc\b|\bbep\s*-?\s*20\b|\bbinance(?:\s*smart)?(?:\s*chain)?\b/i },
  { label: "Avalanche", match: /\bavax\b|\bavalanche\b/i },
  { label: "Linea", match: /\blinea\b/i },
  { label: "Scroll", match: /\bscroll\b/i },
  { label: "Ethereum", match: /\bethereum\b|\betherium\b|\berc\s*-?\s*20\b|\beth\s*main(?:net)?\b|\bmainnet\b/i },
];

/**
 * The same chains, in the order to OFFER them when the user hasn't said which.
 *
 * Resolution order puts Ethereum last so a named chain always wins; a person
 * being asked "which network?" expects to read it first.
 */
export const EVM_CHAIN_LABELS = ["Ethereum", "Base", "Arbitrum", "Polygon", "BNB Chain", "Optimism", "Avalanche", "Linea", "Scroll"];

/**
 * Which EVM chain a message names, or undefined when it names none.
 *
 * Bare "ETH" is NOT treated as naming Ethereum: it is the asset, and someone
 * sending ETH to an Arbitrum or Base wallet says exactly that. Only the chain's
 * own name counts.
 */
export function parseEvmChain(text: string): string | undefined {
  const q = (text ?? "").trim();
  if (!q) return undefined;
  for (const { label, match } of EVM_CHAINS) if (match.test(q)) return label;
  return undefined;
}

/**
 * The network to confirm for an address, given what the user said.
 *
 * Returns undefined only for an EVM address on a message that named no chain —
 * the one case where we genuinely don't know, and where guessing sends real
 * money onto a rail the recipient may not be watching.
 */
export function networkFor(family: ChainFamily, text: string): string | undefined {
  return family === "evm" ? parseEvmChain(text) : FAMILY_NETWORK[family];
}

/**
 * The asset someone named, by symbol or by its full name.
 *
 * "Send 0.05 Solana" names SOL as surely as "0.05 SOL" does, and a voice note
 * will always give you the word rather than the ticker. Without this, a crypto
 * request carrying no wallet address fell through to the naira parser and came
 * back as a ₦5 bank transfer, complete with a list of the user's bank
 * beneficiaries — which is a long way from what they asked for.
 */
/**
 * Spellings included because a transcriber produced them, not because anyone
 * would type them. "Okay, send SOL" came back as "Okay. Send soul." — the word
 * is right there in the sentence and the app still could not see it. These are
 * the sound-alikes for the tickers people actually say out loud.
 */
const ASSET_WORDS: [RegExp, string][] = [
  [/\bs(?:ol|oul|ole|ola|olar)\b|\bsol[ao]n[ao]\b|\bsalana\b/i, "SOL"],
  [/\busdc\b|\bu\s*s\s*d\s*c\b|\busd\s*coin\b/i, "USDC"],
  [/\busdt\b|\bu\s*s\s*d\s*t\b|\btethers?\b|\busd\s*tether\b/i, "USDT"],
  [/\bbtc\b|\bb\s*t\s*c\b|\bbit\s*coins?\b/i, "BTC"],
  [/\beth(?:er(?:eum)?)?\b|\be\s*t\s*h\b|\betherium\b/i, "ETH"],
  [/\bbnb\b|\bb\s*n\s*b\b|\bbinance(?:\s*coin)?\b/i, "BNB"],
  [/\bxrp\b|\bx\s*r\s*p\b|\bripple\b/i, "XRP"],
];

/**
 * Returns a symbol only from `allowed` when given — the assets that can
 * actually be sent on the chain in hand — so naming one we can't send there
 * stays a question rather than becoming a wrong guess.
 */
export function parseCryptoAsset(text: string, allowed?: readonly string[]): string | undefined {
  const q = (text ?? "").trim();
  if (!q) return undefined;
  for (const [pattern, symbol] of ASSET_WORDS) {
    if (!pattern.test(q)) continue;
    if (allowed && !allowed.includes(symbol)) continue;
    return symbol;
  }
  return undefined;
}

/** True when the message names any crypto asset at all. */
export function mentionsCrypto(text: string): boolean {
  return !!parseCryptoAsset(text);
}

/** Shorten an address for display without hiding the ends people check. */
export function shortAddress(a: string): string {
  return a.length <= 20 ? a : `${a.slice(0, 10)}…${a.slice(-8)}`;
}
