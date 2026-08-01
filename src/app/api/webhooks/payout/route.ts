import { NextResponse } from "next/server";
import { finalizePayout } from "@/lib/settlement";
import { verifyFlutterwaveWebhook } from "@/lib/settlement/flutterwave";
import { verifyPaystackWebhook } from "@/lib/settlement/webhook";

export const dynamic = "force-dynamic";

/**
 * Payout webhook for both providers — we detect which one by its signature
 * header, verify it, then mark the settlement + transaction completed or failed
 * (refunding the debited crypto on failure). Matching is by our own `reference`,
 * which both providers echo back.
 *
 * Flutterwave: `verif-hash` header, data.status SUCCESSFUL/FAILED.
 * Paystack:    `x-paystack-signature` header, event transfer.success/failed/reversed.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const flwSig = req.headers.get("verif-hash");
  const psSig = req.headers.get("x-paystack-signature");

  let event: { event?: string; data?: { id?: number; reference?: string; status?: string } };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 422 });
  }

  let verified = false;
  let status: "completed" | "failed" | null = null;
  const data = event.data;

  if (psSig) {
    verified = verifyPaystackWebhook(raw, psSig);
    status = (event.event ?? "").toLowerCase() === "transfer.success" ? "completed" : "failed";
  } else if (flwSig) {
    verified = verifyFlutterwaveWebhook(flwSig);
    status = (data?.status ?? "").toUpperCase() === "SUCCESSFUL" ? "completed" : "failed";
  }

  if (!verified) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  if (!data) return NextResponse.json({ ok: true, ignored: true });

  try {
    // Both providers echo our own `reference`; match on that.
    const result = await finalizePayout({ reference: data.reference }, status!);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
