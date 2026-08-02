import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { finalizePayout, finalizeBuy, creditNairaDeposit } from "@/lib/settlement";
import { verifyFlutterwaveWebhook } from "@/lib/settlement/flutterwave";
import { verifyPaystackWebhook } from "@/lib/settlement/webhook";

export const dynamic = "force-dynamic";

/**
 * Fan-out to other backends that share this Flutterwave account. Flutterwave
 * only allows ONE webhook URL per account, so if a sibling product (e.g.
 * Surlink) also uses it, point Flutterwave here and set WEBHOOK_FORWARD_URL
 * (comma-separated) to the other backends. We re-post the exact raw body and the
 * `verif-hash` header, so each backend verifies and processes its own events and
 * safely ignores the rest. Best-effort: a slow/down sibling never fails our own
 * processing.
 */
async function fanOut(raw: string, verifHash: string | null): Promise<void> {
  const targets = (process.env.WEBHOOK_FORWARD_URL ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!targets.length) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    await Promise.allSettled(
      targets.map((url) =>
        fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", ...(verifHash ? { "verif-hash": verifHash } : {}) },
          body: raw,
          signal: ctrl.signal,
        }),
      ),
    );
  } catch {
    /* never let forwarding break our own webhook */
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Provider webhook for payouts AND buy-collections — Paystack/Flutterwave deliver
 * both to a single account webhook URL, so we route by event type after verifying
 * the signature. Matching is by our own `reference`, which providers echo back.
 *
 *   transfer.success/failed/reversed → finalizePayout (naira withdrawal)
 *   charge.success / charge.failed    → finalizeBuy    (buy-crypto on-ramp)
 *
 * Flutterwave uses `verif-hash` + data.status SUCCESSFUL/FAILED.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const flwSig = req.headers.get("verif-hash");

  // If a sibling product shares this Flutterwave account, forward every event to
  // it before we handle our own. Surlink etc. verify + process independently.
  if (flwSig) await fanOut(raw, flwSig);
  const psSig = req.headers.get("x-paystack-signature");

  let event: {
    event?: string;
    data?: { id?: number; reference?: string; tx_ref?: string; status?: string; amount?: number; currency?: string; customer?: { email?: string } };
  };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 422 });
  }

  const data = event.data;
  const evt = (event.event ?? "").toLowerCase();

  try {
    if (psSig) {
      if (!verifyPaystackWebhook(raw, psSig)) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      if (!data?.reference) return NextResponse.json({ ok: true, ignored: true });

      // Collections (buy on-ramp).
      if (evt.startsWith("charge.")) {
        const status = evt === "charge.success" ? "completed" : "failed";
        const result = await finalizeBuy({ reference: data.reference }, status);
        return NextResponse.json({ ok: true, kind: "buy", ...result });
      }
      // Transfers (naira payout).
      const status = evt === "transfer.success" ? "completed" : "failed";
      const result = await finalizePayout({ reference: data.reference }, status);
      return NextResponse.json({ ok: true, kind: "payout", ...result });
    }

    if (flwSig) {
      if (!verifyFlutterwaveWebhook(flwSig)) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      // Charges echo our tx_ref; transfers echo reference.
      const ref = data?.tx_ref ?? data?.reference;
      if (!ref) return NextResponse.json({ ok: true, ignored: true });
      const status = (data?.status ?? "").toUpperCase() === "SUCCESSFUL" ? "completed" : "failed";

      // Collections come as charge.completed. First try to match a buy order;
      // if it's not a buy, it's a dedicated-account (naira) deposit.
      if (evt.startsWith("charge")) {
        const buy = await finalizeBuy({ reference: ref }, status);
        if (buy.updated) return NextResponse.json({ ok: true, kind: "buy", ...buy });

        // Naira DVA funding — credit the user whose dedicated account this is.
        if (status === "completed" && data?.customer?.email && data.amount && data.amount > 0) {
          const user = await prisma.user.findFirst({ where: { email: data.customer.email, nairaAccount: { not: null } } });
          if (user) {
            const dep = await creditNairaDeposit({
              userId: user.id,
              amount: data.amount,
              currency: (data.currency || "NGN").toUpperCase(),
              externalId: `flw_${data.id ?? ref}`,
              raw: data,
            });
            return NextResponse.json({ ok: true, kind: "naira-deposit", ...dep });
          }
        }
        return NextResponse.json({ ok: true, ignored: true });
      }
      const result = await finalizePayout({ reference: ref }, status);
      return NextResponse.json({ ok: true, kind: "payout", ...result });
    }

    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
