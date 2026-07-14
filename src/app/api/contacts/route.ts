import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized } from "@/lib/api";

export const dynamic = "force-dynamic";

// People you can Ttip: your saved beneficiaries + other users on the platform.
export async function GET(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const q = new URL(req.url).searchParams.get("q")?.toLowerCase().replace(/^@/, "") ?? "";

    const users = await prisma.user.findMany({
      where: {
        id: { not: userId },
        ...(q ? { OR: [{ username: { contains: q } }, { name: { contains: q, mode: "insensitive" } }] } : {}),
      },
      select: { username: true, name: true, avatarGradient: true, verified: true },
      take: 20,
      orderBy: { createdAt: "asc" },
    });

    const beneficiaries = await prisma.beneficiary.findMany({ where: { userId, type: "ttip" } });

    const contacts = [
      ...users.map((u) => ({
        name: u.name,
        handle: "@" + u.username,
        gradient: u.avatarGradient,
        verified: u.verified,
        initial: u.name.charAt(0).toUpperCase(),
        onPlatform: true,
      })),
      ...beneficiaries
        .filter((b) => !users.find((u) => "@" + u.username === b.handle))
        .map((b) => ({
          name: b.name,
          handle: b.handle ?? "",
          gradient: b.avatarGradient,
          verified: false,
          initial: b.name.charAt(0).toUpperCase(),
          onPlatform: false,
        })),
    ];
    return ok({ contacts });
  });
}
