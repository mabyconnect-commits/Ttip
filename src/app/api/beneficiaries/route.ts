import { z } from "zod";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized } from "@/lib/api";

export const dynamic = "force-dynamic";

const GRADIENTS = ["135deg,#6D5BFF,#2AC8FF", "135deg,#FF9A5B,#FF5B8F", "135deg,#2AC8FF,#3DF5B0", "135deg,#6D5BFF,#B45BFF"];

// List saved bank beneficiaries.
export async function GET() {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const rows = await prisma.beneficiary.findMany({ where: { userId, type: "bank" }, orderBy: { name: "asc" } });
    return ok({
      beneficiaries: rows.map((b) => ({
        id: b.id,
        name: b.name,
        bank: b.detail,
        account: b.handle ?? "",
        gradient: b.avatarGradient,
        initial: b.name.charAt(0).toUpperCase(),
      })),
    });
  });
}

const create = z.object({
  name: z.string().min(2, "Enter the account name"),
  bank: z.string().min(2, "Choose a bank"),
  account: z.string().regex(/^\d{6,12}$/, "Enter a valid account number"),
});

export async function POST(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const { name, bank, account } = create.parse(await req.json());
    const b = await prisma.beneficiary.create({
      data: {
        userId,
        type: "bank",
        name,
        detail: bank,
        handle: account,
        avatarGradient: GRADIENTS[Math.floor(Math.random() * GRADIENTS.length)],
      },
    });
    return ok({ id: b.id });
  });
}

export async function DELETE(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const id = new URL(req.url).searchParams.get("id");
    if (id) await prisma.beneficiary.deleteMany({ where: { id, userId } });
    return ok({ ok: true });
  });
}
