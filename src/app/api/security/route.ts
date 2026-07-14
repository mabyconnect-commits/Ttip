import { z } from "zod";
import { prisma } from "@/lib/db";
import { getUserId, hashPassword, verifyPassword } from "@/lib/auth";
import { handler, ok, unauthorized, ApiError } from "@/lib/api";

const schema = z.object({
  currentPassword: z.string().min(1, "Enter your current password"),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});

// Change account password.
export async function PATCH(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const { currentPassword, newPassword } = schema.parse(await req.json());
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return unauthorized();
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new ApiError("Current password is incorrect", 400);
    }
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword) } });
    return ok({ ok: true });
  });
}
