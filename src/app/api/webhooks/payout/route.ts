import { NextResponse } from "next/server";
import { finalizePayout } from "@/lib/settlement";
import { verifyFlutterwaveWebhook } from "@/lib/settlement/flutterwave";

export const dynamic = "force-dynamic";

/**
 * Flutterwave transfer webhook. Fired when a payout settles or fails. We verify
 * the shared `verif-hash`, then mark the settlement + transaction completed or
 * failed (refunding the debited crypto on failure).
 *
 * Docs: https://developer.flutterwave.com/docs/integration-guides/webhooks
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyFlutterwaveWebhook(req.headers.get("verif-hash"))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: { event?: string; data?: { id?: number; reference?: string; status?: string } };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 422 });
  }

  const data = event.data;
  if (!data) return NextResponse.json({ ok: true, ignored: true });

  const status = (data.status ?? "").toUpperCase() === "SUCCESSFUL" ? "completed" : "failed";
  try {
    const result = await finalizePayout(
      { externalId: data.id != null ? String(data.id) : undefined, reference: data.reference },
      status,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
