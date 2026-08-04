import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { toUsd, convert } from "@/lib/prices";
import { qualifies, describeDisqualifier, type ReferralFacts } from "@/lib/campaign-rules";

/**
 * Influencer campaigns. Admin-only, never exposed to users.
 *
 * An influencer is set a target — "100 people who sign up, deposit ₦1,000 of
 * real money, trade, and still hold it 72 hours later" — and paid a flat fee
 * when they hit it. Progress is counted from what actually happened on the
 * platform, never from anything the influencer reports.
 *
 * The word "real" carries the weight here: only deposits a payment provider
 * settled count. Signup bonuses, referral credit and (historically) the deposit
 * simulator all create balances out of nothing, and paying an influencer for
 * those is paying for air.
 */

export const dynamic = "force-dynamic";

// Providers that mean money genuinely arrived. Anything else is platform-created.
const REAL_PROVIDERS = ["dextopus", "flutterwave", "paystack", "monnify", "coralpay"];

async function isAdmin(userId: string): Promise<boolean> {
  const raw = process.env.ADMIN_EMAILS ?? process.env.ADMIN_MAILS ?? "";
  const admins = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!admins.length) return false;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return !!user && admins.includes(user.email.toLowerCase());
}

async function guard(): Promise<string | NextResponse> {
  const userId = await getUserId();
  // 404 rather than 403: don't confirm the endpoint exists to a non-admin.
  if (!userId || !(await isAdmin(userId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return userId;
}

const createSchema = z.object({
  name: z.string().min(2).max(80),
  /** Email or @username of the influencer. */
  influencer: z.string().min(2),
  note: z.string().max(500).optional(),
  minDepositNgn: z.number().positive().default(1000),
  requireTrade: z.boolean().default(true),
  holdHours: z.number().int().min(0).max(24 * 90).default(72),
  minHoldNgn: z.number().min(0).default(1000),
  targetCount: z.number().int().positive().max(100_000).default(100),
  rewardNgn: z.number().positive(),
  endsAt: z.string().datetime().optional(),
});

/** NGN value of a user's whole wallet right now. */
async function holdingNgn(balances: { symbol: string; amount: unknown }[]): Promise<number> {
  let total = 0;
  for (const b of balances) {
    const n = Number(b.amount);
    if (n > 0) total += await convert(n, b.symbol, "NGN");
  }
  return total;
}

export async function GET() {
  const g = await guard();
  if (typeof g !== "string") return g;

  const campaigns = await prisma.campaign.findMany({
    orderBy: { createdAt: "desc" },
    include: { influencer: { select: { name: true, username: true, email: true, referralCode: true } } },
  });

  const out = [];
  for (const c of campaigns) {
    const rules = {
      minDepositNgn: Number(c.minDepositNgn),
      requireTrade: c.requireTrade,
      holdHours: c.holdHours,
      minHoldNgn: Number(c.minHoldNgn),
    };

    // Everyone who signed up on this influencer's code.
    const referred = await prisma.user.findMany({
      where: { referredById: c.influencerId, createdAt: { gte: c.startsAt } },
      select: { id: true, name: true, username: true, createdAt: true, balances: true },
    });

    let qualified = 0;
    const pending: { name: string; reason: string }[] = [];

    for (const r of referred) {
      // Real, provider-settled deposits only.
      const settlements = await prisma.settlement.findMany({
        where: {
          userId: r.id,
          status: "completed",
          kind: { in: ["deposit", "buy"] },
          provider: { in: REAL_PROVIDERS },
        },
        select: { asset: true, amount: true, createdAt: true },
      });

      const realDeposits: ReferralFacts["realDeposits"] = [];
      for (const s of settlements) {
        const ngn = await convert(Number(s.amount), s.asset, "NGN");
        if (ngn > 0) realDeposits.push({ ngn, at: s.createdAt });
      }

      const traded = rules.requireTrade
        ? (await prisma.transaction.count({
            where: { userId: r.id, status: "completed", type: { in: ["swap", "buy"] } },
          })) > 0
        : true;

      const verdict = qualifies(
        { joinedAt: r.createdAt, realDeposits, traded, holdingNgn: await holdingNgn(r.balances) },
        rules,
        { startsAt: c.startsAt, endsAt: c.endsAt },
      );

      if (verdict.qualified) qualified += 1;
      else if (verdict.reason && verdict.reason !== "window") {
        pending.push({ name: r.name || `@${r.username}`, reason: describeDisqualifier(verdict.reason) });
      }
    }

    out.push({
      id: c.id,
      name: c.name,
      status: c.status,
      influencer: {
        name: c.influencer.name,
        username: c.influencer.username,
        email: c.influencer.email,
        code: c.influencer.referralCode,
      },
      note: c.note,
      rules,
      targetCount: c.targetCount,
      rewardNgn: Number(c.rewardNgn),
      rewardUsd: await toUsd(Number(c.rewardNgn), "NGN"),
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      paidAt: c.paidAt,
      signups: referred.length,
      qualified,
      /** True once the target is met — the moment the fee is owed. */
      complete: qualified >= c.targetCount,
      // Cost per qualified user, so a deal that isn't worth repeating is obvious.
      costPerQualified: qualified > 0 ? Number(c.rewardNgn) / qualified : null,
      pending: pending.slice(0, 12),
    });
  }

  return NextResponse.json({ campaigns: out });
}

export async function POST(req: Request) {
  const g = await guard();
  if (typeof g !== "string") return g;

  const input = createSchema.parse(await req.json());
  const key = input.influencer.replace(/^@/, "").toLowerCase();
  const influencer = await prisma.user.findFirst({
    where: { OR: [{ email: key }, { username: key }] },
    select: { id: true, name: true, referralCode: true },
  });
  if (!influencer) {
    return NextResponse.json({ error: `No user matches "${input.influencer}"` }, { status: 400 });
  }

  const campaign = await prisma.campaign.create({
    data: {
      name: input.name,
      influencerId: influencer.id,
      note: input.note,
      minDepositNgn: input.minDepositNgn,
      requireTrade: input.requireTrade,
      holdHours: input.holdHours,
      minHoldNgn: input.minHoldNgn,
      targetCount: input.targetCount,
      rewardNgn: input.rewardNgn,
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
    },
  });

  return NextResponse.json({
    ok: true,
    id: campaign.id,
    influencer: influencer.name,
    // The link the influencer shares — attribution runs on their referral code.
    code: influencer.referralCode,
  });
}

const patchSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["active", "paid", "cancelled"]),
});

/** Mark a campaign paid or cancelled. Marking paid does NOT move money —
 *  the fee is settled off-platform, and this only records that it was. */
export async function PATCH(req: Request) {
  const g = await guard();
  if (typeof g !== "string") return g;

  const { id, status } = patchSchema.parse(await req.json());
  await prisma.campaign.update({
    where: { id },
    data: { status, paidAt: status === "paid" ? new Date() : null },
  });
  return NextResponse.json({ ok: true });
}
