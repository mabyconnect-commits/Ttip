import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { NIGERIAN_BANKS } from "../banks";

/**
 * Reading an account off a photo.
 *
 * The scenario this exists for: you're standing in a market, the vendor's
 * account details are written on a board or shown on their phone, you
 * photograph it and say "send 7k to this account". Typing a ten-digit NUBAN
 * from a photo, standing up, in a hurry, is exactly where people mistype and
 * send money to a stranger.
 *
 * Two rules govern everything here:
 *
 *  1. THE MODEL READS, IT DOES NOT DECIDE. It returns digits and a bank name,
 *     and every one of those is then validated by us — ten digits, a bank we
 *     recognise, an amount that parses. Anything it invents fails validation
 *     rather than reaching a payment.
 *
 *  2. THE NAME STILL COMES FROM THE BANK. Whatever the photo says the account
 *     holder is called is never shown as fact; the account is resolved with the
 *     bank and the bank's answer is what the user confirms against. A photo can
 *     be stale, cropped or forged — the bank's record can't be.
 */

const MODEL = "claude-opus-5";

export interface ExtractedPayment {
  /** Ten-digit NUBAN, or null when the image had none we could trust. */
  accountNumber: string | null;
  /** A bank name matched against our own list, never the model's phrasing. */
  bankName: string | null;
  /** The name printed in the image — for cross-checking only, never authority. */
  printedName: string | null;
  /** An amount if the image itself stated one (an invoice, a price list). */
  amount: number | null;
}

export type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

/** Media types Claude accepts. Anything else is refused before it costs a call. */
export function imageMediaType(mime: string | undefined | null): ImageMediaType | null {
  const m = (mime ?? "").toLowerCase().split(";")[0].trim();
  if (m === "image/jpeg" || m === "image/jpg") return "image/jpeg";
  if (m === "image/png") return "image/png";
  if (m === "image/gif") return "image/gif";
  if (m === "image/webp") return "image/webp";
  return null;
}

const PROMPT = `You are reading a photograph for a Nigerian payments app. The user
photographed someone's bank account details — a screenshot, a handwritten note, a
shop sign, a printed invoice.

Return ONLY a JSON object, no prose and no code fence:

{"accountNumber": "0123456789" | null,
 "bankName": "Opay" | null,
 "printedName": "ABIKE VICTORIA IBRAHIM" | null,
 "amount": 7000 | null}

Rules:
- accountNumber: the Nigerian NUBAN, exactly 10 digits, digits only. If you cannot
  read every digit with confidence, return null. A wrong digit sends someone's
  money to a stranger — null is always better than a guess.
- bankName: the bank as printed. Do not normalise or expand it.
- printedName: the account holder's name as printed, if shown.
- amount: only if the image itself states an amount to pay. Otherwise null.
- If the image is not about a bank account at all, return every field null.`;

/**
 * Ask the model to read the image. Returns all-null rather than throwing, so a
 * bad photo degrades into "I couldn't read that" instead of an error.
 */
export async function extractPaymentFromImage(
  base64: string,
  mediaType: ImageMediaType,
): Promise<ExtractedPayment> {
  const empty: ExtractedPayment = { accountNumber: null, bankName: null, printedName: null, amount: null };
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return empty;

  try {
    const client = new Anthropic({ apiKey: key });
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: "Read the account details." },
          ],
        },
      ],
    });

    if (res.stop_reason === "refusal") return empty;

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return validate(text);
  } catch (e) {
    console.error("[vision] extraction failed", e);
    return empty;
  }
}

/**
 * Everything the model returned, checked against our own rules.
 *
 * This is the half that matters. The model is an OCR engine here, not a
 * decision-maker: a NUBAN that isn't ten digits, or a bank we don't have a code
 * for, is dropped rather than carried forward into a payment.
 */
export function validate(raw: string): ExtractedPayment {
  const empty: ExtractedPayment = { accountNumber: null, bankName: null, printedName: null, amount: null };

  // Tolerate a code fence or stray prose around the object.
  const match = (raw ?? "").match(/\{[\s\S]*\}/);
  if (!match) return empty;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return empty;
  }

  const digits = String(parsed.accountNumber ?? "").replace(/\D/g, "");
  const accountNumber = digits.length === 10 ? digits : null;

  // Keep a leading minus. Stripping every non-digit turned "-500" into 500 —
  // a negative amount silently becoming a real payment.
  const amountText = String(parsed.amount ?? "").trim();
  const negative = amountText.startsWith("-");
  const amountRaw = Number(amountText.replace(/[^0-9.]/g, ""));
  const amount = !negative && Number.isFinite(amountRaw) && amountRaw > 0 ? amountRaw : null;

  const printed = String(parsed.printedName ?? "").trim();

  return {
    accountNumber,
    bankName: matchBank(String(parsed.bankName ?? "")),
    printedName: printed && printed.length <= 80 ? printed : null,
    amount,
  };
}

/**
 * Map whatever the photo said to a bank we can actually pay.
 *
 * Signs and screenshots say "OPay", "Opay Digital", "Paycom", "GTB", "Zenith
 * Bank Plc". Only a name in our list can be turned into a bank code, so an
 * unmatched name becomes null and the user is asked — never guessed at.
 */
export function matchBank(input: string): string | null {
  const raw = norm(input ?? "");
  if (!raw) return null;

  // "GTB" is written more often than "Guaranty Trust". Only the handful the
  // parenthetical abbreviations don't already cover.
  const ALIASES: Record<string, string> = { gtb: "gtbank", gt: "gtbank", firstbank: "first" };
  const q = ALIASES[raw] ?? raw;

  // Every way a bank can be named: its full name, and the abbreviation our own
  // list already carries in brackets — "United Bank For Africa (UBA)" answers
  // to "UBA", and that's data we have rather than a table to maintain.
  const candidates = NIGERIAN_BANKS.map((b) => {
    const inBrackets = [...b.name.matchAll(/\(([^)]+)\)/g)].map((m) => norm(m[1]));
    return { name: b.name, forms: [norm(b.name), ...inBrackets].filter(Boolean) };
  });

  const exact = candidates.find((c) => c.forms.includes(q));
  if (exact) return exact.name;

  const prefixed = candidates.filter((c) => c.forms.some((f) => f.startsWith(q)));
  if (prefixed.length === 1) return prefixed[0].name;

  const contained = candidates.filter((c) => c.forms.some((f) => f.includes(q) || q.includes(f)));
  if (contained.length === 1) return contained[0].name;

  // Two or more plausible banks is a question, not a coin toss: paying the
  // wrong one is unrecoverable.
  return null;
}

/** Strip the corporate noise so "Zenith Bank Plc" and "zenith" are the same thing. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/\b(bank|plc|limited|ltd|microfinance|mfb|digital|services|nigeria)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
