/**
 * Alternative names for the partner banks that host dedicated accounts.
 *
 * Flutterwave reports one name for the bank, but other banks' apps list the
 * same institution under a different one — a user was shown "Flutterwave MFB
 * (Formerly OK MFB)" while their own bank listed it as "Orokam Microfinance
 * Bank Ltd" (OK MFB = OroKam). Searching the name we displayed found nothing,
 * so the transfer nearly didn't happen.
 *
 * Showing every known name for the same bank costs nothing and saves the user
 * from concluding the account is fake.
 *
 * Dependency-free so both the client and the server can use it.
 */

/** Groups of names that all refer to the same institution. */
const ALIAS_GROUPS: string[][] = [
  ["Flutterwave MFB", "OK MFB", "Orokam Microfinance Bank Ltd", "Orokam MFB"],
  ["Wema Bank", "Wema"],
  ["Providus Bank", "Providus"],
  ["Sterling Bank", "Sterling"],
];

/** Loose match: case, punctuation, "(formerly …)" suffixes and Ltd/Plc noise. */
function normalize(name: string): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ") // drop "(Formerly OK MFB)"
    .replace(/\b(ltd|limited|plc|bank|microfinance|mfb)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Other names the same bank is listed under, excluding the one passed in.
 * Empty when we know of no alternatives.
 */
export function bankAliases(bankName: string | null | undefined): string[] {
  if (!bankName) return [];
  const key = normalize(bankName);
  if (!key) return [];
  for (const group of ALIAS_GROUPS) {
    if (group.some((n) => normalize(n) === key || key.includes(normalize(n)) || normalize(n).includes(key))) {
      return group.filter((n) => normalize(n) !== key);
    }
  }
  return [];
}
