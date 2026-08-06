import crypto from "crypto";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { handler, ok, unauthorized, ApiError } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { normalisePhone, sendSms, smsEnabled } from "@/lib/sms/provider";
import { issueSheet, codesLeft, nextCodeIndex } from "@/lib/sms/codes";
import { smsMaxTransfer, smsDailyCap } from "@/lib/sms/limits";
import { COMPANY } from "@/lib/company";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Binding a phone number to an account, and issuing its code sheet.
 *
 * Two proofs, in this order: a code we text to the number proves control of the
 * SIM, and typing it back into the signed-in app proves control of the account.
 * Either alone is worthless — SMS sender ids are spoofable, and a session
 * cookie says nothing about which phone someone is holding.
 *
 * The sheet is shown ONCE, when the number is verified or when the user asks
 * for a new one. Nothing stores the codes; a lost sheet is replaced, never
 * recovered, because a sheet we could recover is one an attacker could too.
 */

const CODE_TTL_MS = 10 * 60_000;

function sixDigits(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

function hash(code: string): string {
  return crypto.createHash("sha256").update(`phone-link:${code}`).digest("hex");
}

export async function GET() {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const link = await prisma.phoneLink.findUnique({ where: { userId } });
    return ok({
      enabled: smsEnabled(),
      phone: link?.verifiedAt ? link.phone : null,
      pending: link && !link.verifiedAt ? link.phone : null,
      codesLeft: link?.verifiedAt ? await codesLeft(userId) : 0,
      nextIndex: link?.verifiedAt ? await nextCodeIndex(userId) : null,
      maxTransfer: smsMaxTransfer(),
      dailyCap: smsDailyCap(),
    });
  });
}

export async function POST(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();
    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      phone?: string;
      code?: string;
    };

    if (body.action === "start") {
      if (!smsEnabled()) throw new ApiError("SMS isn't switched on for this deployment yet.", 503);
      const phone = normalisePhone(body.phone ?? "");
      if (!phone) throw new ApiError("Enter a valid Nigerian phone number.", 400);

      // One SIM, one account. Otherwise a message from that number is ambiguous
      // — and ambiguity about whose money is moving isn't resolved by guessing.
      const taken = await prisma.phoneLink.findUnique({ where: { phone } });
      if (taken && taken.userId !== userId && taken.verifiedAt) {
        throw new ApiError("That number is already linked to another account.", 409);
      }

      rateLimit(`phone-link:${userId}`, { limit: 5, windowMs: 30 * 60_000 });
      rateLimit(`phone-link-num:${phone}`, { limit: 5, windowMs: 30 * 60_000 });

      const code = sixDigits();
      await prisma.phoneLink.upsert({
        where: { userId },
        create: { userId, phone, codeHash: hash(code), codeSentAt: new Date(), attempts: 0 },
        update: { phone, codeHash: hash(code), codeSentAt: new Date(), attempts: 0, verifiedAt: null },
      });

      const sent = await sendSms(phone, `${code} is your ${COMPANY.product} code. It expires in 10 minutes.`);
      if (!sent) throw new ApiError("We couldn't send the text. Check the number and try again.", 502);
      return ok({ sent: true, phone });
    }

    if (body.action === "verify") {
      const link = await prisma.phoneLink.findUnique({ where: { userId } });
      if (!link?.codeHash || !link.codeSentAt) throw new ApiError("Start again — there's no code waiting.", 400);
      if (Date.now() - link.codeSentAt.getTime() > CODE_TTL_MS) {
        throw new ApiError("That code has expired. Send a new one.", 400);
      }
      if (link.attempts >= 5) throw new ApiError("Too many wrong codes. Send a new one.", 429);

      const given = Buffer.from(hash((body.code ?? "").trim()));
      const expected = Buffer.from(link.codeHash);
      const good = given.length === expected.length && crypto.timingSafeEqual(given, expected);
      if (!good) {
        await prisma.phoneLink.update({ where: { userId }, data: { attempts: { increment: 1 } } });
        throw new ApiError("That code isn't right.", 401);
      }

      await prisma.phoneLink.update({
        where: { userId },
        data: { verifiedAt: new Date(), codeHash: null, codeSentAt: null, attempts: 0 },
      });

      // The sheet, in the clear, exactly once.
      return ok({ verified: true, phone: link.phone, sheet: await issueSheet(userId) });
    }

    if (body.action === "newSheet") {
      const link = await prisma.phoneLink.findUnique({ where: { userId } });
      if (!link?.verifiedAt) throw new ApiError("Link a phone number first.", 400);
      return ok({ sheet: await issueSheet(userId) });
    }

    if (body.action === "unlink") {
      await prisma.$transaction([
        prisma.smsCode.deleteMany({ where: { userId } }),
        prisma.phoneLink.deleteMany({ where: { userId } }),
      ]);
      return ok({ unlinked: true });
    }

    throw new ApiError("Unknown action.", 400);
  });
}
