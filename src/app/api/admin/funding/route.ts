import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { toUsd } from "@/lib/prices";

export const dynamic = "force-dynamic";

/**
 * Funding audit + clawback, over HTTP — the same logic as
 * `npm run audit:funding` / `npm run clawback`, reachable from a browser so it
 * can be run without a terminal or database URL to hand.
 *
 * Restricted to ADMIN_EMAILS; everyone else gets 404 (not 403 — an unauthorised
 * caller shouldn't learn the endpoint exists).
 *
 *   GET  /api/admin/funding             → read-only report, changes nothing
 *   POST /api/admin/funding?apply=1     → debit the unfunded balances
 *   POST /api/admin/funding?apply=1&user=someone@example.com  → one account
 *
 * Safety, identical to the CLI: never takes a balance negative, never touches
 * platform promos, only debits the specific assets that were simulated, writes
 * an `adjustment` transaction per debit, and subtracts prior reversals so
 * running it twice can't double-charge.
 */

const REAL_PROVIDERS = ["dextopus", "flutterwave", "paystack", "monnify", "coralpay"];
const GRANT_TYPES = ["deposit_bonus", "referral_bonus", "referral_withdraw", "cashback"];

async function isAdmin(userId: string): Promise<boolean> {
  const raw = process.env.ADMIN_EMAILS ?? process.env.ADMIN_MAILS ?? "";
  const admins = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!admins.length) return false; // no admin list → endpoint stays closed
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return !!user && admins.includes(user.email.toLowerCase());
}

interface Debit {
  symbol: string;
  debit: number;
  shortfall: number;
}

/**
 * Unfunded amount per asset for one user, net of anything already reversed.
 * `sources` explains where each figure came from, so a real user's balance can
 * be checked by eye before it's debited — a ₦500 line could be the signup
 * bonus rather than abuse, and the two must never be confused.
 */
async function unfundedFor(userId: string, sources: string[] = []): Promise<Map<string, number>> {
  const out = new Map<string, number>();

  const settlements = await prisma.settlement.findMany({
    where: { userId, status: "completed", kind: { in: ["deposit", "buy"] } },
  });
  for (const s of settlements) {
    if (REAL_PROVIDERS.includes(s.provider)) continue;
    out.set(s.asset, (out.get(s.asset) ?? 0) + Number(s.amount));
    sources.push(`simulated ${s.kind} ${s.amount} ${s.asset} via ${s.provider} (${s.externalId})`);
  }

  // Fiat deposits need care: a REAL Flutterwave dedicated-account deposit and
  // the old simulator both write a "deposit" transaction with counterparty
  // "Bank transfer". Treating them alike flagged genuine money as fake — a real
  // ₦2,250 deposit showed up as simulated, and debiting it would have taken a
  // user's own money.
  //
  // The one reliable difference: a real deposit also writes a Settlement, the
  // simulator never did. So per currency, only the excess of bank-transfer
  // transactions OVER the real settlements backing them is simulated.
  const bankTxns = await prisma.transaction.findMany({
    where: { userId, type: "deposit", status: "completed", counterparty: "Bank transfer" },
  });
  const realByAsset = new Map<string, number>();
  for (const s of settlements) {
    if (!REAL_PROVIDERS.includes(s.provider)) continue;
    realByAsset.set(s.asset, (realByAsset.get(s.asset) ?? 0) + Number(s.amount));
  }
  const bankByAsset = new Map<string, number>();
  for (const t of bankTxns) {
    const asset = t.assetOut ?? "NGN";
    bankByAsset.set(asset, (bankByAsset.get(asset) ?? 0) + Number(t.amountOut ?? 0));
  }
  for (const [asset, credited] of bankByAsset) {
    const backed = realByAsset.get(asset) ?? 0;
    const unbacked = credited - backed;
    if (unbacked > 1e-9) {
      out.set(asset, (out.get(asset) ?? 0) + unbacked);
      sources.push(
        `${unbacked} ${asset} of bank deposits with no settlement behind them ` +
          `(credited ${credited}, only ${backed} backed by a real provider)`,
      );
    }
  }

  // Balances with no deposit provenance at all (demo seed / manual edits), less
  // whatever promos legitimately explain.
  if (settlements.length === 0 && bankTxns.length === 0) {
    const [balances, grants] = await Promise.all([
      prisma.balance.findMany({ where: { userId } }),
      prisma.transaction.findMany({ where: { userId, status: "completed", type: { in: GRANT_TYPES } } }),
    ]);
    const granted = new Map<string, number>();
    for (const g of grants) {
      const a = g.assetOut ?? "NGN";
      granted.set(a, (granted.get(a) ?? 0) + Number(g.amountOut ?? 0));
    }
    for (const b of balances) {
      const g = granted.get(b.symbol) ?? 0;
      const unexplained = Number(b.amount) - g;
      if (unexplained > 0) {
        out.set(b.symbol, unexplained);
        sources.push(
          `${unexplained} ${b.symbol} held with no deposit of any kind` +
            (g > 0 ? ` (after allowing ${g} ${b.symbol} of promos)` : "") +
            ` — demo seed or manual DB edit`,
        );
      }
    }
  }

  // Net off previous clawbacks so a re-run is a no-op, not a second charge.
  const prior = await prisma.transaction.findMany({
    where: { userId, type: "adjustment", meta: { path: ["reason"], equals: "unfunded_credit_reversal" } },
  });
  for (const r of prior) {
    const asset = r.assetIn ?? "";
    if (!out.has(asset)) continue;
    const left = (out.get(asset) ?? 0) - Number(r.amountIn ?? 0);
    sources.push(`${r.amountIn} ${asset} already reversed by an earlier clawback`);
    if (left > 1e-9) out.set(asset, left);
    else out.delete(asset);
  }

  return out;
}

/**
 * Platform-wide reconciliation.
 *
 * The per-account figures below only see unfunded money AT ITS POINT OF ENTRY.
 * Once it's swapped into another asset or Ttipped to someone else it stops
 * matching the deposit that created it, so per-account totals UNDERSTATE the
 * hole — an account showing ₦500 of simulated deposit can be sitting on far
 * more, because the rest arrived as a swap or a transfer.
 *
 * This works the other way round instead: everything users hold, versus
 * everything that legitimately entered. The difference is the true size of the
 * hole, no matter how the money moved after it was created.
 */
async function reconcile() {
  const usd = async (amount: number, symbol: string) => (amount > 0 ? toUsd(amount, symbol) : 0);

  const [balances, cards, realDeposits, grants, withdrawals] = await Promise.all([
    prisma.balance.findMany({ select: { symbol: true, amount: true } }),
    prisma.card.findMany({ select: { balanceUsd: true } }),
    prisma.settlement.findMany({
      where: { kind: { in: ["deposit", "buy"] }, status: "completed", provider: { in: REAL_PROVIDERS } },
      select: { asset: true, amount: true },
    }),
    prisma.transaction.findMany({
      where: { status: "completed", type: { in: GRANT_TYPES } },
      select: { assetOut: true, amountOut: true },
    }),
    prisma.transaction.findMany({
      where: { status: "completed", type: { in: ["withdraw_bank", "withdraw_wallet", "bill", "card_spend"] } },
      select: { assetIn: true, amountIn: true },
    }),
  ]);

  let heldUsd = 0;
  for (const b of balances) heldUsd += await usd(Number(b.amount), b.symbol);
  for (const c of cards) heldUsd += Number(c.balanceUsd);

  let realFundedUsd = 0;
  for (const d of realDeposits) realFundedUsd += await usd(Number(d.amount), d.asset);

  let grantsUsd = 0;
  for (const g of grants) grantsUsd += await usd(Number(g.amountOut ?? 0), g.assetOut ?? "NGN");

  let withdrawnUsd = 0;
  for (const w of withdrawals) withdrawnUsd += await usd(Number(w.amountIn ?? 0), w.assetIn ?? "USDT");

  // What users should be holding if every naira of it was real.
  const expectedUsd = realFundedUsd + grantsUsd - withdrawnUsd;

  return {
    heldUsd,
    realFundedUsd,
    grantsUsd,
    withdrawnUsd,
    expectedUsd,
    unbackedUsd: Math.max(0, heldUsd - expectedUsd),
    note:
      "Held minus (real deposits + promos − withdrawals). This is the true hole: it counts unfunded money " +
      "even after it was swapped into another asset or sent to another account, which the per-account list cannot see.",
  };
}

async function report(userFilter?: string) {
  const users = await prisma.user.findMany({
    where: userFilter ? { OR: [{ email: userFilter }, { username: userFilter }, { id: userFilter }] } : undefined,
    include: { balances: true },
    orderBy: { createdAt: "asc" },
  });

  const rows = [];
  let totalRecoverableUsd = 0;
  let totalGoneUsd = 0;

  for (const u of users) {
    const sources: string[] = [];
    const unfunded = await unfundedFor(u.id, sources);
    if (!unfunded.size) continue;

    const debits: Debit[] = [];
    let recoverableUsd = 0;
    let goneUsd = 0;
    for (const [symbol, amount] of unfunded) {
      const bal = Number(u.balances.find((b) => b.symbol === symbol)?.amount ?? 0);
      const debit = Math.min(amount, bal);
      const shortfall = Math.max(0, amount - bal);
      debits.push({ symbol, debit, shortfall });
      if (debit > 0) recoverableUsd += await toUsd(debit, symbol);
      if (shortfall > 0) goneUsd += await toUsd(shortfall, symbol);
    }

    totalRecoverableUsd += recoverableUsd;
    totalGoneUsd += goneUsd;
    rows.push({ userId: u.id, email: u.email, username: u.username, debits, recoverableUsd, goneUsd, sources });
  }

  return { accounts: rows, totalRecoverableUsd, totalGoneUsd, reconciliation: await reconcile() };
}

export async function GET(req: Request) {
  const userId = await getUserId();
  if (!userId || !(await isAdmin(userId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const user = new URL(req.url).searchParams.get("user") ?? undefined;
  const result = await report(user);
  return NextResponse.json({
    mode: "dry-run",
    note: "Nothing was changed. POST to this URL with ?apply=1 to debit.",
    ...result,
  });
}

/**
 * The demo accounts prisma/seed.ts created on every build. They hold balances
 * nobody paid for, are marked `verified`, and share a published password, so
 * they're a standing way in — zeroing the balance would leave the login open.
 */
const DEMO_EMAIL_SUFFIX = "@ttip.money";

/**
 * Delete the seeded demo accounts outright.
 *
 * Guarded hard, because deleting a user cascades to their balances, addresses,
 * card and history and cannot be undone:
 *   - the email must end in @ttip.money, AND
 *   - the account must never have received money from a real provider.
 * A real person who happens to use an @ttip.money address is therefore safe:
 * one real settlement and the account is skipped.
 */
async function deleteDemoAccounts(apply: boolean) {
  const candidates = await prisma.user.findMany({
    where: { email: { endsWith: DEMO_EMAIL_SUFFIX } },
    select: { id: true, email: true, username: true },
  });

  const deleted: string[] = [];
  const skipped: { email: string; reason: string }[] = [];

  for (const u of candidates) {
    const realMoney = await prisma.settlement.count({
      where: { userId: u.id, status: "completed", provider: { in: REAL_PROVIDERS } },
    });
    if (realMoney > 0) {
      skipped.push({ email: u.email, reason: `has ${realMoney} real settlement(s) — this is a real account` });
      continue;
    }
    deleted.push(u.email);
    if (apply) await prisma.user.delete({ where: { id: u.id } });
  }

  return { deleted, skipped, applied: apply };
}

export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId || !(await isAdmin(userId))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const params = new URL(req.url).searchParams;
  const userFilter = params.get("user") ?? undefined;
  const apply = params.get("apply") === "1";

  // Delete the seeded demo accounts. Separate from the clawback on purpose:
  // real users' balances are never touched by this.
  if (params.get("deleteDemo") === "1") {
    const result = await deleteDemoAccounts(apply);
    return NextResponse.json({
      action: "deleteDemo",
      mode: apply ? "applied" : "dry-run",
      note: apply ? "Accounts deleted." : "Nothing was changed. Add &apply=1 to delete.",
      ...result,
    });
  }

  const result = await report(userFilter);
  if (!apply) {
    return NextResponse.json({ mode: "dry-run", note: "Add ?apply=1 to actually debit.", ...result });
  }

  // A blanket debit would hit real people who did nothing wrong. Require either
  // a named account (?user=) or an explicit ?all=1, so "apply to everyone" can
  // never be the result of leaving a parameter off.
  if (!userFilter && params.get("all") !== "1") {
    return NextResponse.json(
      {
        error: "Refusing to debit every account at once.",
        note:
          "Pass &user=<email> to debit one account, or &all=1 if you really mean everyone. " +
          "Real users' balances should normally be left alone.",
        wouldAffect: result.accounts.map((a) => a.email),
      },
      { status: 400 },
    );
  }

  let applied = 0;
  for (const row of result.accounts) {
    await prisma.$transaction(async (tx) => {
      for (const d of row.debits) {
        if (!(d.debit > 0)) continue;
        await tx.balance.update({
          where: { userId_symbol: { userId: row.userId, symbol: d.symbol } },
          data: { amount: { decrement: d.debit } },
        });
        await tx.transaction.create({
          data: {
            userId: row.userId,
            type: "adjustment",
            status: "completed",
            assetIn: d.symbol,
            amountIn: new Prisma.Decimal(d.debit),
            counterparty: "Ttip",
            note: "Reversal of unfunded (test) credit",
            emoji: "⚖️",
            meta: {
              reason: "unfunded_credit_reversal",
              shortfall: d.shortfall,
              appliedAt: new Date().toISOString(),
            } as Prisma.InputJsonValue,
          },
        });
        applied++;
      }
    });
  }

  return NextResponse.json({ mode: "applied", debitsApplied: applied, ...result });
}
