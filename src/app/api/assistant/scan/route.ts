import { z } from "zod";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized, ApiError } from "@/lib/api";
import { extractPaymentFromImage, imageMediaType } from "@/lib/assistant/vision";
import { parseAmount, parseBankName } from "@/lib/assistant/intent";
import { NIGERIAN_BANKS } from "@/lib/banks";
import { resolveAccountName } from "@/lib/settlement";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Photograph an account, get a payment ready to confirm.
 *
 * The market case: the vendor's details are on a board or a phone screen, and
 * typing ten digits standing up in a hurry is where people mistype and pay a
 * stranger. Photograph it instead.
 *
 * The model here is an OCR engine, not a decision-maker. It returns digits; we
 * check they're a ten-digit NUBAN, check the bank against our own list, and then
 * ask the BANK who owns the account. What the user confirms against is the
 * bank's answer — never the name printed in the photo, which can be stale,
 * cropped or staged.
 *
 * And it still ends at the PIN. Nothing here moves money.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Roughly 4MB of image once base64 is decoded. */
const MAX_BASE64 = 5_600_000;

const schema = z.object({
  /** Bare base64, or a data: URL — the client shouldn't have to care. */
  image: z.string().min(32).max(MAX_BASE64),
  mimeType: z.string().max(80).optional(),
  /** What they typed alongside it: "send 7k to this". */
  caption: z.string().max(300).optional(),
});

export async function POST(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();

    try {
      // Vision calls cost real money and an image is a big upload.
      rateLimit(`scan:${userId}`, { limit: 12, windowMs: 5 * 60_000 });
    } catch {
      throw new ApiError("That's a lot of photos at once — give it a minute.", 429);
    }

    const input = schema.parse(await req.json());

    // Accept a data: URL and take the media type from it when there is one.
    let base64 = input.image;
    let mime = input.mimeType;
    const dataUrl = base64.match(/^data:([^;,]+)[^,]*,(.*)$/s);
    if (dataUrl) {
      mime = mime ?? dataUrl[1];
      base64 = dataUrl[2];
    }

    const mediaType = imageMediaType(mime);
    if (!mediaType) {
      throw new ApiError("That image format isn't supported. Send a JPEG or PNG.", 415);
    }

    const found = await extractPaymentFromImage(base64, mediaType);
    const caption = input.caption ?? "";

    if (!found.accountNumber) {
      return ok({
        text:
          "I couldn't read an account number from that clearly enough to trust it — and I'd rather ask than " +
          "guess with your money. Type the number and bank, or try a sharper photo.",
      });
    }

    // The caption wins over the image: what the user just said they want to send
    // beats a figure printed on someone else's invoice.
    const amount = parseAmount(caption) ?? found.amount;
    const bankName =
      parseBankName(caption, NIGERIAN_BANKS.map((b) => b.name)) ??
      found.bankName ??
      (await knownBankFor(userId, found.accountNumber));

    if (!bankName) {
      return ok({
        text: `I read the account number ${found.accountNumber}${
          found.printedName ? ` (${found.printedName})` : ""
        }, but not the bank. Which bank is it?`,
      });
    }

    if (!amount) {
      return ok({
        text: `Got it — ${found.accountNumber} at ${bankName}${
          found.printedName ? ` (${found.printedName})` : ""
        }. How much should I send?`,
      });
    }

    // The name on the confirmation comes from the bank, not the photograph.
    const resolved = await resolveAccountName(bankName, found.accountNumber, "NGN").catch(() => null);

    return ok({
      text: resolved
        ? `${found.accountNumber} at ${bankName} is ${resolved}. Sending NGN ${amount.toLocaleString(
            "en-US",
          )} — check the name and confirm with your PIN.`
        : `Ready to send NGN ${amount.toLocaleString("en-US")} to ${found.accountNumber} at ${bankName}. ` +
          `I couldn't confirm the account name, so check the number carefully before you confirm.`,
      draft: {
        kind: "transfer" as const,
        amount,
        fiat: "NGN",
        beneficiaryName: resolved ?? found.printedName ?? `${bankName} ${found.accountNumber}`,
        accountNumber: found.accountNumber,
        bankName,
        resolvedName: resolved,
      },
    });
  });
}

/** If they've paid this account before, we already know the bank. */
async function knownBankFor(userId: string, accountNumber: string): Promise<string | null> {
  const hit = await prisma.beneficiary.findFirst({
    where: { userId, detail: accountNumber, type: "bank" },
    select: { handle: true },
  });
  return hit?.handle ?? null;
}
