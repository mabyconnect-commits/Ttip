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
  const transfer = out.testTransfer?.body;
  const msg: string = (transfer?.message ?? "").toString();
  if (transfer) {
    if (/ip whitelist/i.test(msg)) {
      return "Flutterwave is blocking transfers until IP Whitelisting is set up. Vercel uses dynamic IPs, so route Flutterwave through a static-IP proxy (set FLUTTERWAVE_PROXY_URL) and whitelist that IP, or enable IP whitelisting on your Flutterwave dashboard.";
    }
    if (/insufficient/i.test(msg)) return "Payout balance is too low — top up your Flutterwave PAYOUT wallet (separate from collections).";
    if (transfer?.status === "success" || out.testTransfer?.status === 200) return "Transfer accepted ✅ — payouts are working.";
  }
  const bal = out.ngnBalance?.body?.data?.available_balance;
  if (typeof bal === "number") return `Balance/API reachable (₦${bal} available). Add &send=1&account=&bank=&amount= to test a real transfer and see any block.`;
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
