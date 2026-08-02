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
