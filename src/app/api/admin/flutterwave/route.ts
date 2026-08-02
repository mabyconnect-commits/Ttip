import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { flutterwaveConfig } from "@/lib/settlement/config";
import { fwFetch } from "@/lib/settlement/flutterwave";

export const dynamic = "force-dynamic";

/**
 * Flutterwave transfer diagnostic. Shows the raw provider responses so you can
 * see EXACTLY why a payout is failing — balance, transfer-API access, and
 * (optionally) a live test transfer.
 *
 * Restricted to ADMIN_EMAILS (or a demo deployment); everyone else gets 404.
 *
 *   /api/admin/flutterwave                                   → balance + transfers-API check
 *   /api/admin/flutterwave?send=1&account=0690000031&bank=044&amount=100
 *                                                            → attempt a real ₦100 transfer, show the exact error
 */
async function isAdmin(userId: string): Promise<boolean> {
  // Tolerate a common env-var misspelling (ADMIN_MAILS) so a typo doesn't lock
  // the operator out of their own diagnostic.
  const raw = process.env.ADMIN_EMAILS ?? process.env.ADMIN_MAILS ?? "";
  const admins = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!admins.length) return process.env.DEMO_MODE === "true";
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return !!user && admins.includes(user.email.toLowerCase());
}

/** Turn the raw provider responses into a one-line plain-English diagnosis. */
function interpret(out: Record<string, any>): string {
  const proxied = !!process.env.FLUTTERWAVE_PROXY_URL;
  const egressIp: string | undefined = out.egressIp?.ip;
  // Suffix that tells the operator the exact IP to whitelist and whether it's stable.
  const ipHint = egressIp
    ? proxied
      ? ` Whitelist this static proxy IP on Flutterwave: ${egressIp}.`
      : ` This request left from ${egressIp}, but with no proxy that IP rotates per call — whitelisting it won't hold.`
    : "";

  const transfer = out.testTransfer?.body;
  const msg: string = (transfer?.message ?? "").toString();
  if (transfer) {
    // Flutterwave says "ip whitelist" explicitly on some accounts, and returns a
    // generic "This request cannot be processed. Please contact support" /
    // "not permitted" on others — both are the same IP-allowlist block for a
    // live Transfers account calling from an un-whitelisted address.
    if (/ip whitelist|whitelist|cannot be processed|not permitted|contact support/i.test(msg)) {
      const base = proxied
        ? "Flutterwave is still rejecting the transfer. A static-IP proxy is configured — make sure its IP is the one whitelisted on your Flutterwave dashboard (Settings → API → IP Whitelist)."
        : "Flutterwave is blocking transfers until IP Whitelisting is set up. Vercel uses dynamic IPs, so route Flutterwave through a static-IP proxy (set FLUTTERWAVE_PROXY_URL) and whitelist that IP — whitelisting a single observed Vercel IP won't hold because the next call egresses from a different address.";
      return base + ipHint;
    }
    if (/insufficient/i.test(msg)) return "Payout balance is too low — top up your Flutterwave PAYOUT wallet (separate from collections).";
    if (transfer?.status === "success" || out.testTransfer?.status === 200) return "Transfer accepted ✅ — payouts are working." + (egressIp ? ` (egress IP ${egressIp})` : "");
    if (msg) return `Flutterwave rejected the transfer: "${msg}".` + ipHint;
  }
  const bal = out.ngnBalance?.body?.data?.available_balance;
  if (typeof bal === "number") return `Balance/API reachable (₦${bal} available).${ipHint} Add &send=1&account=&bank=&amount= to test a real transfer and see any block.`;
  return "Could not read Flutterwave — check FLUTTERWAVE_SECRET_KEY.";
}

export async function GET(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  if (!(await isAdmin(userId))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const cfg = flutterwaveConfig();
  if (!cfg) return NextResponse.json({ error: "Flutterwave not configured (FLUTTERWAVE_SECRET_KEY missing)" }, { status: 400 });

  const auth = { Authorization: `Bearer ${cfg.secretKey}` };
  const url = new URL(req.url);
  const out: Record<string, unknown> = { baseUrl: cfg.baseUrl, keyPrefix: cfg.secretKey.slice(0, 12) + "…" };

  async function call(label: string, path: string, init?: RequestInit) {
    try {
      const r = await fwFetch(`${cfg!.baseUrl}${path}`, init ?? {});
      out[label] = { status: r.status, body: await r.json().catch(() => null) };
    } catch (e) {
      out[label] = { error: String(e) };
    }
  }

  out.proxy = process.env.FLUTTERWAVE_PROXY_URL ? "configured (static-IP egress)" : "none (direct Vercel egress — dynamic IP)";

  // 0. Egress IP as seen by an outside echo — routed through fwFetch, so it uses
  //    the SAME path (static proxy or direct Vercel) that Flutterwave calls take.
  //    This is the exact address to put on Flutterwave's IP whitelist.
  try {
    const r = await fwFetch("https://api.ipify.org?format=json", {});
    const body = (await r.json().catch(() => null)) as { ip?: string } | null;
    out.egressIp = { ip: body?.ip, note: process.env.FLUTTERWAVE_PROXY_URL ? "static (via proxy) — whitelist this" : "dynamic (rotates per call) — whitelisting won't stick without a proxy" };
  } catch (e) {
    out.egressIp = { error: String(e) };
  }

  // 1. Available payout balance.
  await call("ngnBalance", "/balances/NGN", { headers: auth });
  // 2. Does the transfers API even work for this account? (fee lookup hits it)
  await call("transferFeeCheck", "/transfers/fee?amount=1000&currency=NGN", { headers: auth });

  // 3. Optional: attempt a real transfer to see the exact rejection.
  if (url.searchParams.get("send") === "1") {
    const account = url.searchParams.get("account");
    const bank = url.searchParams.get("bank"); // numeric bank code, e.g. 044 (Access), 999992 (Opay)
    const amount = Number(url.searchParams.get("amount") || 100);
    if (!account || !bank) {
      out.testTransfer = { skipped: "provide &account=<nuban>&bank=<code>&amount=<naira>" };
    } else {
      await call("testTransfer", "/transfers", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ account_bank: bank, account_number: account, amount, currency: "NGN", narration: "Ttip diagnostic", reference: "diag_" + Date.now(), debit_currency: "NGN" }),
      });
    }
  }

  out.diagnosis = interpret(out);
  return NextResponse.json(out);
}
