import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword, createSession } from "@/lib/auth";
import { handler, ok, ApiError } from "@/lib/api";
import { getAppState } from "@/lib/serialize";
import { provisionAccount, pickGradient, makeReferralCode } from "@/lib/provision";

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

      // credit referrer if applicable
      if (referrer) {
        await tx.referral.create({ data: { referrerId: referrer.id, joinedName: input.name } });
        await tx.user.update({
          where: { id: referrer.id },
          data: { referralEarned: { increment: 2000 }, points: { increment: 200 } },
        });
        await tx.balance.upsert({
          where: { userId_symbol: { userId: referrer.id, symbol: "NGN" } },
          create: { userId: referrer.id, symbol: "NGN", kind: "fiat", amount: 2000 },
          update: { amount: { increment: 2000 } },
        });
        await tx.transaction.create({
          data: {
            userId: referrer.id,
            type: "referral_bonus",
            assetOut: "NGN",
            amountOut: 2000,
            counterparty: input.name,
            note: "Referral bonus",
            emoji: "👯",
          },
        });
      }
      return created;
    });

    await createSession(user.id);
    const state = await getAppState(user.id);
    return ok({ ...state }, { status: 201 });
  });
}
