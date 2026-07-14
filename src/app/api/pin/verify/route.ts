import { z } from "zod";
import { prisma } from "@/lib/db";
import { getUserId, verifyPassword } from "@/lib/auth";
import { handler, ok, unauthorized } from "@/lib/api";

const schema = z.object({ pin: z.string() });

// Verify the app-lock PIN (used by the lock screen).
export async function POST(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const { pin } = schema.parse(await req.json());
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.pinHash) return ok({ valid: true }); // no pin set → nothing to unlock
    const valid = await verifyPassword(pin, user.pinHash);
    return ok({ valid });
  });
}
