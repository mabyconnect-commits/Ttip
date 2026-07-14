import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { provisionAccount, pickGradient, makeReferralCode } from "../src/lib/provision";

const prisma = new PrismaClient();

async function createUser(opts: {
  name: string;
  username: string;
  email: string;
  fiat?: string;
  streak?: number;
  points?: number;
  seedBalances?: boolean;
  gradient?: string;
}) {
  const passwordHash = await bcrypt.hash("password123", 10);
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: opts.name,
        username: opts.username,
        email: opts.email,
        passwordHash,
        verified: true,
        avatarGradient: opts.gradient ?? pickGradient(opts.username),
        defaultFiat: opts.fiat ?? "NGN",
        streakDays: opts.streak ?? 0,
        points: opts.points ?? 0,
        referralCode: makeReferralCode(opts.username),
        bankName: "GTBank",
        bankAccount: "GTBank ••7204",
      },
    });
    await provisionAccount(tx, user.id, opts.name, { seed: opts.seedBalances });
    return user;
  });
}

async function main() {
  console.log("Resetting demo data…");
  await prisma.feedItem.deleteMany();
  await prisma.referral.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.beneficiary.deleteMany();
  await prisma.walletAddress.deleteMany();
  await prisma.card.deleteMany();
  await prisma.balance.deleteMany();
  await prisma.user.deleteMany();

  const kola = await createUser({
    name: "Kola Adeyemi", username: "kola", email: "kola@ttip.money",
    streak: 12, points: 2840, seedBalances: true,
    gradient: "135deg,#6D5BFF,#2AC8FF 60%,#3DF5B0",
  });
  const amara = await createUser({
    name: "Amara N.", username: "amara", email: "amara@ttip.money",
    streak: 8, points: 1540, seedBalances: true, gradient: "135deg,#FF9A5B,#FF5B8F",
  });
  const tobi = await createUser({
    name: "Tobi O.", username: "tobi", email: "tobi@ttip.money",
    streak: 5, points: 1880, seedBalances: true, gradient: "135deg,#2AC8FF,#3DF5B0",
  });
  const zuri = await createUser({
    name: "Zuri K.", username: "zuri", email: "zuri@ttip.money",
    streak: 30, points: 2120, seedBalances: true, gradient: "135deg,#6D5BFF,#B45BFF",
  });

  // beneficiaries for kola
  await prisma.beneficiary.createMany({
    data: [
      { userId: kola.id, name: "Amara N.", handle: "@amara", type: "ttip", detail: "@amara", avatarGradient: "135deg,#FF9A5B,#FF5B8F" },
      { userId: kola.id, name: "Tobi O.", handle: "@tobi", type: "ttip", detail: "@tobi", avatarGradient: "135deg,#2AC8FF,#3DF5B0" },
      { userId: kola.id, name: "Zuri K.", handle: "@zuri", type: "ttip", detail: "@zuri", avatarGradient: "135deg,#6D5BFF,#B45BFF" },
    ],
  });

  // sample transactions for kola
  const now = Date.now();
  await prisma.transaction.createMany({
    data: [
      { userId: kola.id, type: "ttip_out", assetIn: "USDT", amountIn: new Prisma.Decimal(15.22), assetOut: "NGN", amountOut: new Prisma.Decimal(25000), counterparty: "@amara", note: "wedding cake 🎂", emoji: "⚡", createdAt: new Date(now - 2 * 60000) },
      { userId: kola.id, type: "swap", assetIn: "USDT", amountIn: new Prisma.Decimal(250), assetOut: "NGN", amountOut: new Prisma.Decimal(410500), counterparty: "GTBank ••7204", note: "Swapped USDT → NGN", emoji: "⇄", createdAt: new Date(now - 40 * 60000) },
      { userId: kola.id, type: "card_spend", assetIn: "USD", amountIn: new Prisma.Decimal(10.99), counterparty: "Spotify", note: "Card · Spotify", emoji: "💳", createdAt: new Date(now - 3 * 3600000) },
      { userId: kola.id, type: "ttip_in", assetOut: "NGN", amountOut: new Prisma.Decimal(8000), counterparty: "@tobi", note: "suya settled 🍢", emoji: "⚡", createdAt: new Date(now - 5 * 3600000) },
      { userId: kola.id, type: "bill", assetIn: "USDT", amountIn: new Prisma.Decimal(1.22), assetOut: "NGN", amountOut: new Prisma.Decimal(2000), counterparty: "MTN · 0803 4421", note: "Airtime — MTN", emoji: "📞", createdAt: new Date(now - 26 * 3600000) },
    ],
  });

  // feed items
  await prisma.feedItem.createMany({
    data: [
      { actorId: amara.id, kind: "tip", actorName: "@amara", targetName: "@kola", amount: new Prisma.Decimal(25000), currency: "NGN", note: "for the wedding cake — you killed it! 🎂", emoji: "🎂", reactions: { "🎉": 24, "🔥": 12, "💬": 6 }, createdAt: new Date(now - 2 * 60000) },
      { actorId: tobi.id, kind: "split", actorName: "@tobi", targetName: "3 friends", amount: new Prisma.Decimal(84000), currency: "NGN", note: "suya night 🍢 everybody paid in 4 seconds flat", emoji: "🍢", reactions: { "😂": 41, "🍢": 18, "💬": 11 }, createdAt: new Date(now - 18 * 60000) },
      { actorId: zuri.id, kind: "streak", actorName: "@zuri", targetName: null, amount: null, currency: null, note: "hit a 30-day tipping streak 🔥", emoji: "🔥", reactions: { "👏": 67, "🔥": 33 }, createdAt: new Date(now - 3600000) },
    ],
  });

  // referrals for kola
  await prisma.referral.createMany({
    data: [
      { referrerId: kola.id, joinedName: "Chidi E.", createdAt: new Date(now - 2 * 864e5) },
      { referrerId: kola.id, joinedName: "Bola A.", createdAt: new Date(now - 6 * 864e5) },
    ],
  });
  await prisma.user.update({ where: { id: kola.id }, data: { referralEarned: new Prisma.Decimal(4000) } });

  console.log("Seed complete. Demo login: kola@ttip.money / password123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
