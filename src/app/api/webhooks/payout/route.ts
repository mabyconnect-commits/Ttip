import { NextResponse } from "next/server";
import { finalizePayout, finalizeBuy } from "@/lib/settlement";
import { verifyFlutterwaveWebhook } from "@/lib/settlement/flutterwave";
import { verifyPaystackWebhook } from "@/lib/settlement/webhook";

export const dynamic = "force-dynamic";

/**
 * Provider webhook for payouts AND buy-collections — Paystack delivers both to a
 * single account webhook URL, so we route by event type after verifying the
 * signature. Matching is by our own `reference`, which providers echo back.
 *
 *   transfer.success/failed/reversed → finalizePayout (naira withdrawal)
 *   charge.success / charge.failed    → finalizeBuy    (buy-crypto on-ramp)
 *
 * Flutterwave payouts use `verif-hash` + data.status SUCCESSFUL/FAILED.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const flwSig = req.headers.get("verif-hash");
  const psSig = req.headers.get("x-paystack-signature");

  let event: { event?: string; data?: { id?: number; reference?: string; tx_ref?: string; status?: string } };
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

      // Collections (buy on-ramp) come as charge.completed.
      if (evt.startsWith("charge")) {
        const result = await finalizeBuy({ reference: ref }, status);
        return NextResponse.json({ ok: true, kind: "buy", ...result });
      }
      const result = await finalizePayout({ reference: ref }, status);
      return NextResponse.json({ ok: true, kind: "payout", ...result });
    }

    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
