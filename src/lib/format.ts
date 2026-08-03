import { FIAT_BY_CODE } from "./constants";

export function fiatSymbol(code: string): string {
  return FIAT_BY_CODE[code]?.symbol ?? "";
}

/** Format a fiat amount like ₦4,268,540.22 */
export function formatFiat(amount: number, code: string, opts?: { decimals?: number }): string {
  const sym = fiatSymbol(code);
  const decimals = opts?.decimals ?? (code === "USD" ? 2 : 2);
  const n = amount.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return code === "KES" ? `${sym} ${n}` : `${sym}${n}`;
}

/** Compact fiat like ₦168.4M */
export function formatFiatCompact(amount: number, code: string): string {
  const sym = fiatSymbol(code);
  const abs = Math.abs(amount);
  let out: string;
  if (abs >= 1e9) out = (amount / 1e9).toFixed(1) + "B";
  else if (abs >= 1e6) out = (amount / 1e6).toFixed(1) + "M";
  else if (abs >= 1e3) out = (amount / 1e3).toFixed(1) + "K";
  else out = amount.toFixed(0);
  return code === "KES" ? `${sym} ${out}` : `${sym}${out}`;
}

/**
 * Trim an amount to a sensible number of significant digits and group the
 * thousands — `1000` reads as `1,000`, not `1000`. Trailing zeros are still
 * dropped, so `0.01820000` stays `0.0182`.
 */
export function formatCrypto(amount: number, symbol: string): string {
  if (amount === 0) return "0";
  const decimals = symbol === "BTC" ? 6 : symbol === "ETH" ? 5 : Math.abs(amount) < 1 ? 6 : 4;
  return parseFloat(amount.toFixed(decimals)).toLocaleString("en-US", { maximumFractionDigits: decimals });
}

export function formatUsd(amount: number): string {
  return "$" + amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** YYYY-MM-DD for a date (UTC). */
export function dayStr(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** True if `day` (YYYY-MM-DD) is exactly one calendar day before `ref`. */
export function isYesterday(day: string, ref: Date = new Date()): boolean {
  const y = new Date(ref);
  y.setUTCDate(y.getUTCDate() - 1);
  return day === y.toISOString().slice(0, 10);
}

export function timeAgo(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return "now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}
