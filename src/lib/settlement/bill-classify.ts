/**
 * Classify Flutterwave's flat biller list into our consumer bill categories and
 * curated providers. Kept dependency-free (no server-only / network) so it's
 * unit-testable — the fetch + cache lives in bill-catalog.ts.
 *
 * Flutterwave returns hundreds of billers (telecoms, DisCos, cable, plus schools,
 * churches, couriers…). We surface only the mainstream consumer categories and
 * name each provider consistently, keying off the item's own fields:
 *   - is_airtime            → airtime
 *   - label_name "Meter"    → electricity
 *   - label_name "Smartcard"→ tv
 *   - a data-bundle name    → data (or internet for fixed-line ISPs)
 */

export interface RawBillItem {
  biller_code?: string;
  item_code?: string;
  name?: string;
  short_name?: string;
  biller_name?: string;
  amount?: number | string;
  is_airtime?: boolean;
  label_name?: string;
  country?: string;
}

export interface BillItem {
  billerCode: string;
  itemCode: string;
  /** Plan / package name shown to the user, e.g. "DStv Compact" or "1.5GB — 30 days". */
  name: string;
  /** Fixed price; 0 when the user enters the amount (airtime, prepaid meter). */
  amount: number;
  variableAmount: boolean;
  /** What to collect: "Phone Number" | "Meter Number" | "Smartcard Number" | … */
  label: string;
}

export interface ProviderGroup {
  provider: string;
  items: BillItem[];
}

export interface CategoryCatalog {
  category: string;
  providers: ProviderGroup[];
}

type Matcher = [name: string, re: RegExp];

// Curated providers per category. Order matters: first match wins.
const PROVIDERS: Record<string, Matcher[]> = {
  airtime: [["MTN", /mtn/i], ["Airtel", /airtel/i], ["Glo", /\bglo\b/i], ["9mobile", /9 ?mobile|etisalat/i]],
  data: [["MTN", /mtn/i], ["Airtel", /airtel/i], ["Glo", /\bglo\b/i], ["9mobile", /9 ?mobile|etisalat/i]],
  tv: [["DStv", /dstv/i], ["GOtv", /gotv/i], ["Startimes", /startimes|star ?times/i], ["Showmax", /showmax/i]],
  electricity: [
    ["Eko (EKEDC)", /ekedc|eko elec|eko disco/i],
    ["Ikeja (IKEDC)", /ikedc|ikeja/i],
    ["Abuja (AEDC)", /aedc|abuja elec/i],
    ["Port Harcourt (PHED)", /phed|port ?harcourt/i],
    ["Ibadan (IBEDC)", /ibedc|ibadan/i],
    ["Enugu (EEDC)", /eedc|enugu/i],
    ["Benin (BEDC)", /bedc|benin disco|benin elec/i],
    ["Kano (KEDCO)", /kedco|kano/i],
    ["Kaduna (KAEDCO)", /kaedco|kaduna/i],
    ["Jos (JED)", /\bjed\b|jos elec|jos disco/i],
    ["Yola (YEDC)", /yedc|yola/i],
    ["Kwara (IBEDC)", /kwara/i],
  ],
  internet: [["Smile", /smile/i], ["Spectranet", /spectranet/i], ["Swift", /swift/i], ["ipNX", /ipnx/i]],
};

const num = (v: number | string | undefined): number => {
  const n = typeof v === "string" ? parseFloat(v) : v ?? 0;
  return Number.isFinite(n) ? Number(n) : 0;
};

/** Which of our categories does this raw biller item belong to? null = skip. */
export function categoryOf(item: RawBillItem): string | null {
  if (item.is_airtime) return "airtime";
  const label = (item.label_name ?? "").toLowerCase();
  const hay = `${item.name ?? ""} ${item.biller_name ?? ""} ${item.short_name ?? ""}`.toLowerCase();

  if (label.includes("meter")) return "electricity";
  if (label.includes("smart")) return "tv"; // "Smartcard Number" / "Smart Card Number"

  const isp = /smile|spectranet|swift|ipnx/.test(hay);
  const looksData = /\bdata\b|bundle|\d+\s?gb|\d+\s?mb/.test(hay);
  if (isp) return looksData || label.includes("account") ? "internet" : null;
  if (looksData && /mtn|airtel|glo|9 ?mobile|etisalat/.test(hay)) return "data";
  return null;
}

/** Match a curated provider name for a category, or null if it isn't one we surface. */
export function providerOf(category: string, item: RawBillItem): string | null {
  const hay = `${item.biller_name ?? ""} ${item.name ?? ""} ${item.short_name ?? ""}`;
  for (const [name, re] of PROVIDERS[category] ?? []) if (re.test(hay)) return name;
  return null;
}

function toItem(raw: RawBillItem): BillItem {
  const amount = num(raw.amount);
  return {
    billerCode: raw.biller_code ?? "",
    itemCode: raw.item_code ?? "",
    name: (raw.name ?? raw.short_name ?? "").trim(),
    amount,
    variableAmount: amount <= 0,
    label: raw.label_name ?? "Phone Number",
  };
}

/**
 * Build the full classified catalog from Flutterwave's raw item list. Groups by
 * category → curated provider, de-duplicates item codes, and sorts fixed plans
 * by price. Uncategorized billers (schools, churches, couriers) are dropped.
 */
export function buildCatalog(raw: RawBillItem[]): Record<string, CategoryCatalog> {
  const out: Record<string, CategoryCatalog> = {};
  const seen = new Set<string>();

  for (const item of raw) {
    if (!item.biller_code || !item.item_code) continue;
    const category = categoryOf(item);
    if (!category) continue;
    const provider = providerOf(category, item);
    if (!provider) continue;

    const dedupeKey = `${category}|${item.biller_code}|${item.item_code}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const cat = (out[category] ??= { category, providers: [] });
    let group = cat.providers.find((p) => p.provider === provider);
    if (!group) {
      group = { provider, items: [] };
      cat.providers.push(group);
    }
    group.items.push(toItem(item));
  }

  // Sort providers in the curated order, and items: variable first, then by price.
  for (const category of Object.keys(out)) {
    const order = (PROVIDERS[category] ?? []).map(([n]) => n);
    out[category].providers.sort((a, b) => order.indexOf(a.provider) - order.indexOf(b.provider));
    for (const g of out[category].providers) {
      g.items.sort((a, b) => Number(a.variableAmount) - Number(b.variableAmount) || a.amount - b.amount);
    }
  }

  return out;
}
