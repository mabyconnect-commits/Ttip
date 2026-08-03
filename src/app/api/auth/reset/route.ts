import crypto from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { handler, ok, ApiError } from "@/lib/api";
import { hashPassword } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/rate-limit";

/**
 * Finish a password reset.
 *
 * The token is looked up by its hash, must be unused and unexpired, and is
 * marked used in the SAME transaction that changes the password — so a token
 * can never be spent twice, even on simultaneous requests.
 *
 * Deliberately does NOT sign the user in afterwards. Whoever holds the link
 * has only proven control of the mailbox; making them log in with the new
 * password means a leaked link alone doesn't hand over a funded account.
 */

const schema = z.object({
  token: z.string().min(20, "This reset link isn't valid."),
  password: z.string().min(8, "Use at least 8 characters"),
});

export async function POST(req: Request) {
  return handler(async () => {
    const ip = clientIp(req);
    rateLimit(`reset:${ip}`, { limit: 10, windowMs: 15 * 60_000 });

    const { token, password } = schema.parse(await req.json());
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const record = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true, usedAt: true },
    });

    // One message for every failure mode — expired, already used, or never
    // existed — so the response can't be used to probe for valid tokens.
    const invalid = new ApiError("This reset link has expired or already been used. Request a new one.", 400);
    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) throw invalid;

    const passwordHash = await hashPassword(password);

    const result = await prisma.$transaction(async (tx) => {
      // Consume the token conditionally: if another request got there first,
      // this updates nothing and we stop.
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) return false;

      await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
      return true;
    });

    if (!result) throw invalid;

    return ok({ reset: true });
  });
}
