// Identity-verification contract shared by every KYC provider adapter. Kept free
// of `server-only` so it can be imported by tests and pure helpers.

export type IdType = "bvn" | "nin" | "passport" | "drivers_license";

export interface KycRequest {
  userId: string;
  fullName: string; // the name the user typed, matched against the ID record
  idType: IdType;
  idNumber: string;
}

export type KycStatus = "verified" | "pending" | "failed";

export interface KycResult {
  status: KycStatus;
  tier: number; // KYC tier to grant on success (1 = unchanged)
  provider: string; // "dojah" | "sandbox" | "manual"
  ref?: string; // provider reference / audit id
  reason?: string; // human-readable failure/pending reason
  matched?: boolean; // did the ID record match the supplied name
}

/**
 * Does the name on the government record match the name the user typed?
 *
 * We require the record's first *and* last name to each appear as a whole word
 * in the supplied name (order-independent, accent/case-insensitive). This stops
 * someone verifying with a valid ID number that isn't theirs, without being so
 * strict that a missing middle name or reordered names fails a real person.
 */
export function nameMatches(supplied: string, record: { firstName?: string; lastName?: string; middleName?: string }): boolean {
  const norm = (s: string) =>
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean);

  const suppliedTokens = new Set(norm(supplied));
  const first = record.firstName ? norm(record.firstName)[0] : undefined;
  const last = record.lastName ? norm(record.lastName)[0] : undefined;
  if (!first || !last) return false;
  return suppliedTokens.has(first) && suppliedTokens.has(last);
}
