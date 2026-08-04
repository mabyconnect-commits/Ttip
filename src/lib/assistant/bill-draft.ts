import "server-only";
import { prisma } from "../db";
import { getCategoryCatalog } from "../settlement/bill-catalog";
import { BILL_FIAT } from "../constants";
import type { BillIntent } from "./intent";

/**
 * Turn "buy me ₦100 airtime" into a concrete, confirmable purchase.
 *
 * Ada never buys anything. This resolves the request to a real biller item and
 * a real phone number, hands it back as a draft, and the user confirms it with
 * their PIN — after which the normal /api/bills path runs every check it always
 * did.
 *
 * The phone number is never taken from free text alone unless the user actually
 * typed one: otherwise it comes from a line they have topped up before. A model
 * inventing a digit sends someone else's airtime, and there is no way back.
 */

export interface BillDraft {
  kind: "bill";
  category: "airtime" | "data";
  provider: string;
  billerCode: string;
  itemCode: string;
  planName: string;
  phone: string;
  amountNgn: number;
  fiat: string;
}

export interface DraftOutcome {
  draft?: BillDraft;
  /** What to say when we can't build one. */
  message: string;
}

/** Lines this user has topped up before, newest first, with the network used. */
async function knownLines(userId: string): Promise<{ phone: string; provider: string }[]> {
  const rows = await prisma.transaction.findMany({
    where: { userId, type: "bill" },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { meta: true, counterparty: true },
  });

  const seen = new Map<string, string>();
  for (const r of rows) {
    const meta = r.meta as { customer?: string; category?: string } | null;
    const phone = meta?.customer;
    if (!phone || !/^0\d{10}$/.test(phone)) continue;
    // counterparty is "Provider · number"; the provider names the network.
    const provider = (r.counterparty ?? "").split("·")[0]?.trim() ?? "";
    if (!seen.has(phone)) seen.set(phone, provider);
  }
  return [...seen].map(([phone, provider]) => ({ phone, provider }));
}

/** Pick the data plan closest to the size asked for, never smaller. */
function matchDataPlan(items: { name: string; amount: number; itemCode: string; billerCode: string; variableAmount: boolean }[], sizeMb: number) {
  const sized = items
    .map((i) => {
      const m = i.name.match(/(\d+(?:\.\d+)?)\s*(mb|gb)/i);
      if (!m) return null;
      const mb = Number(m[1]) * (m[2].toLowerCase() === "gb" ? 1024 : 1);
      return Number.isFinite(mb) && mb > 0 ? { item: i, mb } : null;
    })
    .filter((x): x is { item: (typeof items)[number]; mb: number } => !!x);

  if (!sized.length) return null;
  // Smallest plan that covers the request; if none does, the largest available.
  const covering = sized.filter((s) => s.mb >= sizeMb).sort((a, b) => a.mb - b.mb);
  return (covering[0] ?? sized.sort((a, b) => b.mb - a.mb)[0]).item;
}

export async function buildBillDraft(userId: string, intent: BillIntent): Promise<DraftOutcome> {
  const catalog = await getCategoryCatalog(intent.category);
  if (!catalog || !catalog.providers.length) {
    return { message: `${intent.category === "airtime" ? "Airtime" : "Data"} isn't available right now — try the Bills screen.` };
  }

  const lines = await knownLines(userId);

  // Which network. Explicit wins; otherwise the network of the line we'd use.
  let providerGroup = intent.network
    ? catalog.providers.find((p) => p.provider.toLowerCase().includes(intent.network!.toLowerCase()))
    : undefined;

  // Which line. An explicitly typed number wins. Otherwise a line they've topped
  // up before — matching the named network when they named one.
  let phone = intent.phone;
  if (!phone) {
    const match = intent.network
      ? lines.find((l) => l.provider.toLowerCase().includes(intent.network!.toLowerCase()))
      : lines[0];
    phone = match?.phone;
    if (!providerGroup && match) {
      providerGroup = catalog.providers.find((p) => p.provider.toLowerCase().includes(match.provider.toLowerCase().split(" ")[0]));
    }
  }

  if (!phone) {
    return {
      message:
        lines.length === 0
          ? "I don't have a number for you yet — tell me the line, like \"buy ₦100 MTN airtime for 08012345678\", and I'll set it up."
          : `Which line? You've used ${lines.map((l) => l.phone).slice(0, 3).join(", ")}.`,
    };
  }

  if (!providerGroup) {
    return { message: `Which network is ${phone} on? Say MTN, Glo, Airtel or 9mobile and I'll set it up.` };
  }

  if (intent.category === "airtime") {
    if (!intent.amountNgn) return { message: "How much airtime? Say an amount, like \"buy ₦500 airtime\"." };
    const item = providerGroup.items.find((i) => i.variableAmount) ?? providerGroup.items[0];
    if (!item) return { message: `No airtime plan available for ${providerGroup.provider} right now.` };
    return {
      draft: {
        kind: "bill",
        category: "airtime",
        provider: providerGroup.provider,
        billerCode: item.billerCode,
        itemCode: item.itemCode,
        planName: `₦${intent.amountNgn.toLocaleString()} airtime`,
        phone,
        amountNgn: intent.amountNgn,
        fiat: BILL_FIAT,
      },
      message: `Ready: ₦${intent.amountNgn.toLocaleString()} ${providerGroup.provider} airtime for ${phone}. Confirm with your PIN.`,
    };
  }

  if (!intent.sizeMb) {
    return { message: `How much data? Say a size, like "send 1GB to ${phone}".` };
  }
  const plan = matchDataPlan(providerGroup.items, intent.sizeMb);
  if (!plan) return { message: `No data plans available for ${providerGroup.provider} right now.` };

  return {
    draft: {
      kind: "bill",
      category: "data",
      provider: providerGroup.provider,
      billerCode: plan.billerCode,
      itemCode: plan.itemCode,
      planName: plan.name,
      phone,
      amountNgn: plan.amount,
      fiat: BILL_FIAT,
    },
    message: `Ready: ${plan.name} on ${providerGroup.provider} for ${phone} — ₦${plan.amount.toLocaleString()}. Confirm with your PIN.`,
  };
}
