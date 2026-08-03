const DONE = ["successful", "success", "completed", "delivered"];
const DEAD = ["failed", "error", "reversed"];

/**
 * Normalize a Flutterwave bill response into our status. Kept dependency-free
 * (no server-only / Prisma imports) so it's unit-testable, because the delivery
 * state can arrive in several shapes depending on the biller: data.status,
 * data[0].status, or nested under data.
 *
 * Important: Flutterwave's airtime/bill responses often carry **no delivery
 * status inside `data` at all** — both "Bill payment successful" (create) and
 * "Bill status fetch successful" (re-query) return a bare data payload and put
 * the only status at the TOP level. Reading `data.status` alone therefore made
 * every real bill look "pending" forever even after the biller delivered it, so
 * we fall back to the envelope's own status when `data` doesn't carry one.
 */
export function mapBillStatus(body: unknown): "pending" | "completed" | "failed" {
  const root = body as { status?: unknown; data?: unknown } | null | undefined;
  const data = root?.data;

  // 1. An explicit per-transaction status wins wherever it appears.
  const inner = (
    (data as { status?: unknown })?.status ??
    (Array.isArray(data) ? (data[0] as { status?: unknown })?.status : undefined) ??
    ""
  )
    .toString()
    .toLowerCase();
  if (DONE.includes(inner)) return "completed";
  if (DEAD.includes(inner)) return "failed";
  if (inner) return "pending"; // an explicit "processing"/"pending" — respect it

  // 2. No status inside `data`: fall back to the envelope. A success envelope
  //    carrying an actual bill payload is Flutterwave confirming the bill.
  const envelope = (root?.status ?? "").toString().toLowerCase();
  const hasPayload = Array.isArray(data) ? data.length > 0 : !!data && typeof data === "object";
  if (DEAD.includes(envelope)) return "failed";
  if (DONE.includes(envelope) && hasPayload) return "completed";

  return "pending"; // unknown → wait for webhook or status re-query
}
