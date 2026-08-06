import "server-only";
import crypto from "crypto";

/**
 * Bybit — where treasury USDC becomes naira.
 *
 * Be clear about what is and isn't automatable here, because the difference
 * decides how the rest of the system has to behave.
 *
 * AUTOMATIC (this file):
 *   - the deposit address to send treasury USDC to, per coin and chain
 *   - the balance, so we can see the USDC arrive without anyone watching
 *
 * NOT AUTOMATIC:
 *   - selling that USDC for naira on P2P, and settling the naira into the
 *     payout account. Bybit's P2P endpoints are open to verified merchants
 *     under a separate agreement, and no public API moves naira from a Bybit
 *     account into a Nigerian bank. Pretending otherwise would mean writing
 *     code that silently does nothing while a user waits for their money.
 *
 * So the sell is a person, and the whole design admits it: the payout is HELD
 * rather than failed, the USDC is already on its way before anyone is asked to
 * do anything, and the operator has a fixed window to finish the trade. If
 * merchant P2P access is granted later, `sell()` is the one function that has
 * to start returning a real result — nothing else changes.
 */

export interface BybitConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl: string;
  /** What the treasury sends, and on which chain. */
  coin: string;
  chain: string;
}

export function bybitConfig(): BybitConfig | null {
  const apiKey = process.env.BYBIT_API_KEY?.trim();
  const apiSecret = process.env.BYBIT_API_SECRET?.trim();
  if (!apiKey || !apiSecret) return null;
  return {
    apiKey,
    apiSecret,
    baseUrl: (process.env.BYBIT_BASE_URL || "https://api.bybit.com").replace(/\/$/, ""),
    coin: process.env.BYBIT_SETTLE_COIN || "USDC",
    chain: process.env.BYBIT_SETTLE_CHAIN || "SOL",
  };
}

export function bybitEnabled(): boolean {
  return !!bybitConfig();
}

const RECV_WINDOW = "10000";

/**
 * Bybit V5 signing: HMAC-SHA256 over timestamp + key + recvWindow + payload.
 * The payload is the raw query string for GET and the raw JSON body for POST,
 * so it has to be the exact same string we send — building it twice is how
 * these signatures end up mysteriously invalid.
 */
function sign(cfg: BybitConfig, timestamp: string, payload: string): string {
  return crypto
    .createHmac("sha256", cfg.apiSecret)
    .update(timestamp + cfg.apiKey + RECV_WINDOW + payload)
    .digest("hex");
}

async function call<T>(
  cfg: BybitConfig,
  method: "GET" | "POST",
  path: string,
  params: Record<string, string> = {},
): Promise<{ ok: true; result: T } | { ok: false; message: string }> {
  const timestamp = String(Date.now());
  const query = new URLSearchParams(params).toString();
  const payload = method === "GET" ? query : JSON.stringify(params);
  const url = `${cfg.baseUrl}${path}${method === "GET" && query ? `?${query}` : ""}`;

  try {
    const res = await fetch(url, {
      method,
      headers: {
        "X-BAPI-API-KEY": cfg.apiKey,
        "X-BAPI-TIMESTAMP": timestamp,
        "X-BAPI-RECV-WINDOW": RECV_WINDOW,
        "X-BAPI-SIGN": sign(cfg, timestamp, payload),
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      ...(method === "POST" ? { body: payload } : {}),
    });
    const body = (await res.json().catch(() => null)) as { retCode?: number; retMsg?: string; result?: T } | null;
    if (!body) return { ok: false, message: `Bybit returned no body (${res.status}).` };
    if (body.retCode !== 0) return { ok: false, message: body.retMsg || `Bybit error ${body.retCode}.` };
    return { ok: true, result: body.result as T };
  } catch (e) {
    return { ok: false, message: `Couldn't reach Bybit: ${(e as Error).message}` };
  }
}

/** Where to send treasury USDC so it lands in our Bybit account. */
export async function bybitDepositAddress(): Promise<{ address: string; chain: string } | null> {
  const cfg = bybitConfig();
  if (!cfg) return null;

  const res = await call<{
    chains?: { chain?: string; chainType?: string; addressDeposit?: string; tagDeposit?: string }[];
  }>(cfg, "GET", "/v5/asset/deposit/query-address", { coin: cfg.coin, chainType: cfg.chain });

  if (!res.ok) {
    console.error(`[bybit] deposit address failed: ${res.message}`);
    return null;
  }
  const chains = res.result?.chains ?? [];
  const hit =
    chains.find((c) => (c.chain ?? c.chainType ?? "").toUpperCase() === cfg.chain.toUpperCase()) ?? chains[0];
  const address = hit?.addressDeposit;
  if (!address) {
    console.error("[bybit] deposit address response carried no address");
    return null;
  }
  return { address, chain: hit?.chain ?? cfg.chain };
}

/** How much of the settle coin the Bybit account holds right now. */
export async function bybitBalance(): Promise<number | null> {
  const cfg = bybitConfig();
  if (!cfg) return null;

  const res = await call<{ list?: { coin?: { coin?: string; walletBalance?: string }[] }[] }>(
    cfg,
    "GET",
    "/v5/account/wallet-balance",
    { accountType: "UNIFIED", coin: cfg.coin },
  );
  if (!res.ok) {
    console.error(`[bybit] balance failed: ${res.message}`);
    return null;
  }
  for (const account of res.result?.list ?? []) {
    for (const c of account.coin ?? []) {
      if ((c.coin ?? "").toUpperCase() === cfg.coin.toUpperCase()) return Number(c.walletBalance ?? 0);
    }
  }
  return 0;
}

/**
 * Sell the coin for fiat on P2P.
 *
 * Deliberately not implemented against a guess. Merchant P2P access is granted
 * per-account under a separate agreement, and writing a plausible-looking call
 * that 404s in production would turn "an operator has 20 minutes to finish this
 * trade" into "a user's money is stuck and nothing says why".
 *
 * When access exists, this returns the naira raised and the float tops itself
 * up. Until then it says so, and the operator does the trade — which is what
 * the hold window and the admin queue are for.
 */
export async function bybitSell(): Promise<{ ok: false; message: string }> {
  return {
    ok: false,
    message:
      "Bybit P2P selling isn't automated — merchant API access is granted per account. " +
      "The USDC is on the exchange; finish the sell and mark the float topped up.",
  };
}
