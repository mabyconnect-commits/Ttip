/**
 * Normalize a Flutterwave bill response into our status. Kept dependency-free
 * (no server-only / Prisma imports) so it's unit-testable, because the delivery
 * state can arrive in several shapes depending on the biller: data.status,
 * data[0].status, or nested under data.
 */
export function mapBillStatus(body: unknown): "pending" | "completed" | "failed" {
  const data = (body as { data?: unknown })?.data;
  const raw = (
    (data as { status?: unknown })?.status ??
    (Array.isArray(data) ? (data[0] as { status?: unknown })?.status : undefined) ??
    ""
  )
    .toString()
    .toLowerCase();
  if (["successful", "success", "completed", "delivered"].includes(raw)) return "completed";
  if (["failed", "error", "reversed"].includes(raw)) return "failed";
  return "pending"; // pending / processing / unknown → wait for webhook or status re-query
}
