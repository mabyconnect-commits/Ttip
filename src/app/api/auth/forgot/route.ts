import crypto from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { handler, ok, ApiError } from "@/lib/api";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { mailEnabled, sendMail, passwordResetEmail } from "@/lib/mail";
import { baseUrl } from "@/lib/url";

/**
 * Start a password reset: email the account a single-use link.
 *
 * Two rules this flow lives by:
 *
 * 1. It never reveals whether an address has an account. The response is the
 *    same either way, so this can't be used to enumerate customers — worth more
 *    on a money app than the small convenience of "no account found".
 *
 * 2. Only a HASH of the token is stored. A database leak can't be turned into
 *    account takeovers; the usable token exists only in the email.
 */

const TOKEN_TTL_MIN = 30;

const schema = z.object({ email: z.string().email("Enter a valid email") });

export async function POST(req: Request) {
  return handler(async () => {
    // Tight limits: this endpoint sends email and is unauthenticated.
    const ip = clientIp(req);
    rateLimit(`forgot:${ip}`, { limit: 5, windowMs: 15 * 60_000 });

    const { email } = schema.parse(await req.json());

    if (!mailEnabled()) {
      // Fail loudly rather than silently dropping the email — a user left
      // waiting for a mail that was never sent is locked out of their money.
      throw new ApiError("Password reset isn't available yet. Please contact support.", 503);
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      select: { id: true, name: true, email: true },
    });

    if (user) {
      rateLimit(`forgot-user:${user.id}`, { limit: 3, windowMs: 15 * 60_000 });

      // Invalidate any outstanding links so only the newest one works.
      await prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });

      const token = crypto.randomBytes(32).toString("base64url");
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + TOKEN_TTL_MIN * 60_000),
        },
      });

      const link = `${baseUrl()}/reset?token=${token}`;
      const mail = passwordResetEmail(user.name, link, TOKEN_TTL_MIN);
      await sendMail({ to: user.email, ...mail });
    }

    // Same response whether or not the account exists.
    return ok({ sent: true });
  });
}
