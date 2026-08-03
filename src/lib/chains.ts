// Human names for the chain ids Dextopus uses, so raw numbers never leak into
// the UI (e.g. "792703809" → "Solana"). Covers the common rails; unknown ids
// fall back to the number.
export const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum",
  10: "Optimism",
  56: "BNB Chain",
  137: "Polygon",
  8453: "Base",
  42161: "Arbitrum",
  43114: "Avalanche",
  59144: "Linea",
  534352: "Scroll",
  728126428: "Tron",
  792703809: "Solana",
  8253038: "Bitcoin",
};

export function chainName(id: number | string): string {
  const n = Number(id);
  return CHAIN_NAMES[n] ?? String(id);
}

// Map an asset's network id (see CRYPTO_ASSETS in constants) to the numeric chain
// id Dextopus uses, so a withdrawal knows which chain to send on. Only the rails
// Dextopus can settle are listed; an unmapped network → no Dextopus withdrawal.
export const NETWORK_CHAIN_IDS: Record<string, number> = {
  erc20: 1,
  eth: 1,
  optimism: 10,
  bep20: 56,
  bsc: 56,
  poly: 137,
  matic: 137,
  base: 8453,
  arbitrum: 42161,
  avax: 43114,
  linea: 59144,
  scroll: 534352,
  trc20: 728126428,
  tron: 728126428,
  sol: 792703809,
  solana: 792703809,
  btc: 8253038,
};

/** Resolve a network id/label to a Dextopus chain id, or null if unsupported. */
export function chainIdForNetwork(network: string | undefined): number | null {
  if (!network) return null;
  const key = network.toLowerCase();
  if (NETWORK_CHAIN_IDS[key]) return NETWORK_CHAIN_IDS[key];
  // Fall back to a keyword match on a human label like "TRC-20 (Tron)".
  for (const [k, id] of Object.entries(NETWORK_CHAIN_IDS)) if (key.includes(k)) return id;
  if (/tron/.test(key)) return 728126428;
  if (/solana/.test(key)) return 792703809;
  if (/bitcoin/.test(key)) return 8253038;
  if (/ethereum/.test(key)) return 1;
  if (/bnb|binance/.test(key)) return 56;
  if (/polygon/.test(key)) return 137;
  return null;
}

// Block-explorer tx URL templates per chain id, so users can trace a deposit or
// withdrawal on-chain and confirm it landed.
const EXPLORER_TX: Record<number, string> = {
  1: "https://etherscan.io/tx/",
  10: "https://optimistic.etherscan.io/tx/",
  56: "https://bscscan.com/tx/",
  137: "https://polygonscan.com/tx/",
  8453: "https://basescan.org/tx/",
  42161: "https://arbiscan.io/tx/",
  43114: "https://snowtrace.io/tx/",
  59144: "https://lineascan.build/tx/",
  534352: "https://scrollscan.com/tx/",
  728126428: "https://tronscan.org/#/transaction/",
  792703809: "https://solscan.io/tx/",
  8253038: "https://mempool.space/tx/",
};

/** Full block-explorer URL for a tx hash on a chain, or null if unknown. */
export function explorerTxUrl(chainId: number | string | null | undefined, txHash: string | null | undefined): string | null {
  if (!chainId || !txHash) return null;
  const base = EXPLORER_TX[Number(chainId)];
  return base ? base + txHash : null;
}

/** Replace any standalone known chain-id number inside a string with its name. */
export function prettifyChains(text: string | null | undefined): string {
  if (!text) return text ?? "";
  return text.replace(/\d{2,}/g, (m) => CHAIN_NAMES[Number(m)] ?? m);
}
