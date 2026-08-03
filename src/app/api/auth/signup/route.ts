import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword, createSession } from "@/lib/auth";
import { handler, ok, ApiError } from "@/lib/api";
import { getAppState } from "@/lib/serialize";
import { provisionAccount, pickGradient, makeReferralCode } from "@/lib/provision";
import { rateLimit, clientIp } from "@/lib/rate-limit";

const schema = z.object({
  name: z.string().min(1, "Name is required").max(60),
  email: z.string().email("Enter a valid email"),
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(20)
    .regex(/^[a-zA-Z0-9_]+$/, "Letters, numbers and _ only"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  referralCode: z.string().optional().nullable(),
  defaultFiat: z.string().default("NGN"),
});

export async function POST(req: Request) {
  return handler(async () => {
    // Limit automated account creation: 5 signups / hour per client IP.
    rateLimit(`signup:${clientIp(req)}`, { limit: 5, windowMs: 60 * 60_000 });
    const body = await req.json();
    const input = schema.parse(body);
    const username = input.username.toLowerCase();
    const email = input.email.toLowerCase();

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
    });
    if (existing) {
      throw new ApiError(existing.email === email ? "That email is already registered" : "That username is taken", 409);
    }

    let referrer = null;
    if (input.referralCode) {
      referrer = await prisma.user.findUnique({ where: { referralCode: input.referralCode.toUpperCase() } });
    }

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name: input.name,
          email,
          username,
          passwordHash: await hashPassword(input.password),
          avatarGradient: pickGradient(username),
          defaultFiat: input.defaultFiat,
          referralCode: makeReferralCode(username),
          referredById: referrer?.id ?? null,
          bankName: "GTBank",
          bankAccount: "GTBank ••" + Math.floor(1000 + Math.random() * 8999),
        },
      });
      await provisionAccount(tx, created.id, input.name, { seed: false });

      // Link the referral. No cash changes hands at signup — the referrer earns
      // 25% of this user's fees over time, and this user earns the ₦500
      // first-deposit bonus 72h after their first $10 deposit (see lib/referral.ts).
      // Points are just a light welcome touch, not spendable naira.
      if (referrer) {
        await tx.referral.create({ data: { referrerId: referrer.id, joinedName: input.name, bonus: 0 } });
        await tx.user.update({ where: { id: referrer.id }, data: { points: { increment: 200 } } });
        await tx.user.update({ where: { id: created.id }, data: { points: { increment: 100 } } });
      }
      return created;
    });

    await createSession(user.id);
    const state = await getAppState(user.id);
    return ok({ ...state }, { status: 201 });
  });
}
