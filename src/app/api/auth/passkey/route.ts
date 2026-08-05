import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized, ApiError } from "@/lib/api";

/**
 * The devices signed in to this account — list one, remove one.
 *
 * Removing is as important as adding: a phone that was sold, lost or handed on
 * must be revocable from the account it can still open, and that has to be
 * possible without a support ticket.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();

    const passkeys = await prisma.passkey.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, label: true, createdAt: true, lastUsedAt: true },
    });
    return ok({ passkeys });
  });
}

export async function DELETE(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();

    const id = new URL(req.url).searchParams.get("id");
    if (!id) throw new ApiError("Which device?", 400);

    // Scoped to the signed-in user, so an id from elsewhere removes nothing.
    const { count } = await prisma.passkey.deleteMany({ where: { id, userId } });
    if (!count) throw new ApiError("That device isn't on your account.", 404);
    return ok({ removed: true });
  });
}
