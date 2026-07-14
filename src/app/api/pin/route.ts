import { z } from "zod";
import { prisma } from "@/lib/db";
import { getUserId, hashPassword, verifyPassword } from "@/lib/auth";
import { handler, ok, unauthorized, ApiError } from "@/lib/api";

const setSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, "PIN must be 4 digits"),
  currentPin: z.string().optional(),
});

// Set or change the 4-digit app-lock PIN.
export async function POST(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const { pin, currentPin } = setSchema.parse(await req.json());
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return unauthorized();
    if (user.pinHash && !(currentPin && (await verifyPassword(currentPin, user.pinHash)))) {
      throw new ApiError("Current PIN is incorrect", 400);
    }
    await prisma.user.update({ where: { id: userId }, data: { pinHash: await hashPassword(pin) } });
    return ok({ ok: true, hasPin: true });
  });
}

// Remove the PIN.
export async function DELETE() {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    await prisma.user.update({ where: { id: userId }, data: { pinHash: null } });
    return ok({ ok: true, hasPin: false });
  });
}
