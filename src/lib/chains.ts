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

/** Replace any standalone known chain-id number inside a string with its name. */
export function prettifyChains(text: string | null | undefined): string {
  if (!text) return text ?? "";
  return text.replace(/\d{2,}/g, (m) => CHAIN_NAMES[Number(m)] ?? m);
}
