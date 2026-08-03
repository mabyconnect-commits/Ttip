import "server-only";
import { flutterwaveConfig, isLive } from "./config";
import { fwFetch } from "./flutterwave";
import { buildCatalog, type CategoryCatalog, type RawBillItem, type BillItem } from "./bill-classify";

/**
 * The bill catalog: the providers and plans shown in the app, per category.
 *
 * In live mode it's fetched from Flutterwave's bill-categories list and
 * classified (bill-classify.ts), cached in-process for a day. In demo mode — or
 * if the live fetch fails — a curated static catalog keeps the UX working so the
 * flow is demoable and never blank. Amounts here are indicative; live data wins.
 */

let cache: { at: number; data: Record<string, CategoryCatalog> } | null = null;
const TTL = 24 * 60 * 60 * 1000;

async function fetchRaw(): Promise<RawBillItem[]> {
  const cfg = flutterwaveConfig();
  if (!cfg) return [];
  const res = await fwFetch(`${cfg.baseUrl}/bill-categories?country=NG`, {
    headers: { Authorization: `Bearer ${cfg.secretKey}` },
  });
  const json = (await res.json().catch(() => null)) as { data?: RawBillItem[] } | null;
  return Array.isArray(json?.data) ? json!.data! : [];
}

/** Full catalog keyed by category. Cached; falls back to the static catalog. */
export async function getBillCatalog(): Promise<Record<string, CategoryCatalog>> {
  if (cache && Date.now() - cache.at < TTL) return cache.data;
  if (isLive() && flutterwaveConfig()) {
    try {
      const raw = await fetchRaw();
      const built = buildCatalog(raw);
      // Only trust a live fetch that actually produced the mainstream categories;
      // otherwise keep the static catalog so the UI is never empty.
      if (built.airtime && built.data) {
        backfillAirtimeNetworks(built);
        cache = { at: Date.now(), data: built };
        return built;
      }
    } catch {
      /* fall through to static */
    }
  }
  return STATIC_CATALOG;
}

/**
 * Make sure every major network appears under Airtime.
 *
 * Flutterwave's bill-category list doesn't reliably return a per-network airtime
 * biller for all four — MTN in particular went missing from the live fetch while
 * Airtel, Glo and 9mobile came through, so the app simply had no MTN airtime.
 * Airtime doesn't actually need a per-network biller: the generic item
 * (BIL099/AT099) detects the network from the phone number, so any network the
 * live fetch dropped is backfilled with it. Only ever ADDS a missing network —
 * a network the live fetch did return keeps its own live codes.
 */
function backfillAirtimeNetworks(built: Record<string, CategoryCatalog>): void {
  const airtime = built.airtime;
  if (!airtime) return;
  for (const fallback of STATIC_CATALOG.airtime.providers) {
    if (!airtime.providers.some((p) => p.provider === fallback.provider)) {
      airtime.providers.push(fallback);
    }
  }
  // Keep the familiar MTN / Airtel / Glo / 9mobile order.
  const order = STATIC_CATALOG.airtime.providers.map((p) => p.provider);
  airtime.providers.sort((a, b) => order.indexOf(a.provider) - order.indexOf(b.provider));
}

/** One category's providers + plans. */
export async function getCategoryCatalog(category: string): Promise<CategoryCatalog | null> {
  const all = await getBillCatalog();
  return all[category] ?? STATIC_CATALOG[category] ?? null;
}

/** Look up a specific plan by its codes, to validate a payment request server-side. */
export async function findBillItem(billerCode: string, itemCode: string): Promise<{ category: string; provider: string; item: BillItem } | null> {
  const all = await getBillCatalog();
  for (const cat of Object.values(all)) {
    for (const p of cat.providers) {
      const item = p.items.find((i) => i.billerCode === billerCode && i.itemCode === itemCode);
      if (item) return { category: cat.category, provider: p.provider, item };
    }
  }
  return null;
}

// ── Static fallback catalog (demo / fetch failure) ──────────────────────────
// Codes mirror Flutterwave's well-known NG billers; the generic airtime item
// (BIL099/AT099) auto-detects the network from the phone number.
const AIRTIME = (provider: string): CategoryCatalog["providers"][number] => ({
  provider,
  items: [{ billerCode: "BIL099", itemCode: "AT099", name: `${provider} Airtime`, amount: 0, variableAmount: true, label: "Phone Number" }],
});

const dataPlan = (billerCode: string, itemCode: string, name: string, amount: number): BillItem => ({
  billerCode, itemCode, name, amount, variableAmount: false, label: "Phone Number",
});

const STATIC_CATALOG: Record<string, CategoryCatalog> = {
  airtime: { category: "airtime", providers: [AIRTIME("MTN"), AIRTIME("Airtel"), AIRTIME("Glo"), AIRTIME("9mobile")] },
  data: {
    category: "data",
    providers: [
      { provider: "MTN", items: [dataPlan("BIL108", "MD001", "1GB — 30 days", 1000), dataPlan("BIL108", "MD002", "2GB — 30 days", 2000), dataPlan("BIL108", "MD003", "5GB — 30 days", 4500)] },
      { provider: "Airtel", items: [dataPlan("BIL110", "AD001", "1.5GB — 30 days", 1000), dataPlan("BIL110", "AD002", "4GB — 30 days", 2000), dataPlan("BIL110", "AD003", "10GB — 30 days", 5000)] },
      { provider: "Glo", items: [dataPlan("BIL112g", "GD001", "1.8GB — 30 days", 1000), dataPlan("BIL112g", "GD002", "5.8GB — 30 days", 2000)] },
      { provider: "9mobile", items: [dataPlan("BIL114", "ED001", "1.5GB — 30 days", 1000), dataPlan("BIL114", "ED002", "4.5GB — 30 days", 2500)] },
    ],
  },
  tv: {
    category: "tv",
    providers: [
      { provider: "DStv", items: [dataPlan("BIL121", "CB177", "DStv Compact", 19000), dataPlan("BIL121", "CB178", "DStv Compact + HD", 20700), dataPlan("BIL121", "CB182", "DStv Premium", 44500)].map((i) => ({ ...i, label: "Smartcard Number" })) },
      { provider: "GOtv", items: [dataPlan("BIL122", "GO001", "GOtv Smallie", 1900), dataPlan("BIL122", "GO002", "GOtv Jinja", 3900), dataPlan("BIL122", "GO003", "GOtv Max", 8500)].map((i) => ({ ...i, label: "Smartcard Number" })) },
      { provider: "Startimes", items: [dataPlan("BIL123", "ST001", "Nova", 1300), dataPlan("BIL123", "ST002", "Basic", 2600), dataPlan("BIL123", "ST003", "Smart", 4700)].map((i) => ({ ...i, label: "Smartcard Number" })) },
    ],
  },
  electricity: {
    category: "electricity",
    providers: [
      { provider: "Eko (EKEDC)", items: [{ billerCode: "BIL112", itemCode: "UB157", name: "Prepaid", amount: 0, variableAmount: true, label: "Meter Number" }, { billerCode: "BIL112", itemCode: "UB158", name: "Postpaid", amount: 0, variableAmount: true, label: "Meter Number" }] },
      { provider: "Ikeja (IKEDC)", items: [{ billerCode: "BIL113", itemCode: "UB159", name: "Prepaid", amount: 0, variableAmount: true, label: "Meter Number" }, { billerCode: "BIL113", itemCode: "UB160", name: "Postpaid", amount: 0, variableAmount: true, label: "Meter Number" }] },
      { provider: "Abuja (AEDC)", items: [{ billerCode: "BIL116", itemCode: "UB165", name: "Prepaid", amount: 0, variableAmount: true, label: "Meter Number" }, { billerCode: "BIL116", itemCode: "UB166", name: "Postpaid", amount: 0, variableAmount: true, label: "Meter Number" }] },
      { provider: "Port Harcourt (PHED)", items: [{ billerCode: "BIL117", itemCode: "UB167", name: "Prepaid", amount: 0, variableAmount: true, label: "Meter Number" }, { billerCode: "BIL117", itemCode: "UB168", name: "Postpaid", amount: 0, variableAmount: true, label: "Meter Number" }] },
    ],
  },
  internet: {
    category: "internet",
    providers: [
      { provider: "Smile", items: [dataPlan("BIL124", "IS194", "21GB Bundle", 8190), dataPlan("BIL124", "IS197", "15GB Bundle", 5000)].map((i) => ({ ...i, label: "Account Number" })) },
      { provider: "Spectranet", items: [dataPlan("BIL125s", "SP001", "Voucher 12GB", 4000), dataPlan("BIL125s", "SP002", "Voucher 30GB", 8000)].map((i) => ({ ...i, label: "Account Number" })) },
    ],
  },
};
