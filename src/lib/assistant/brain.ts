import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { assistantRules, ttipKnowledge } from "./knowledge";
import { buildUserContext } from "./context";
import { conversationMessages, type Turn } from "./conversation";
import { cleanAssistantText } from "./sanitize";
import { answerFaq, type FaqContext } from "./faq";
import { draftGap } from "./draft-fill";
import { COMPANY } from "../company";

/**
 * Ada, in a chat window — whichever chat window.
 *
 * Extracted from the Telegram webhook so WhatsApp gets the same assistant
 * rather than a second one that drifts. Two implementations of "what Ada knows"
 * is how a user gets one answer on Telegram and a different one on WhatsApp
 * about the same account, which is worse than having only one surface.
 *
 * What differs per surface is stated, not assumed: how the transfer is
 * confirmed, and whether we can clean up after a secret. That is the whole
 * reason the caller passes a `SurfaceProfile` instead of a name.
 */

const MODEL = "claude-opus-5";
const MAX_TOKENS = 1200;

export interface SurfaceProfile {
  /** "Telegram", "WhatsApp" — used in the prompt so Ada names it correctly. */
  name: string;
  /**
   * How a transfer is authorised here, in one sentence for the model.
   *
   * The difference is real and it matters: Telegram deletes the PIN message the
   * instant it reads it, so asking for a PIN there is defensible. WhatsApp
   * cannot delete a user's message, so a PIN would sit in their history for
   * good — and there it's a single-use code instead.
   */
  authLine: string;
  /** What to say when the account isn't linked yet. */
  linkLine: string;
  /** Surfaces where photos/voice work say so; the others must not offer it. */
  mediaLine?: string;
}

export interface DraftLike {
  kind?: string;
  amount: unknown;
  fiat: string;
  accountNumber: string | null;
  bankName: string | null;
  resolvedName: string | null;
  asset?: string | null;
  network?: string | null;
  address?: string | null;
  scheduleAt?: Date | null;
  scheduleSaid?: string | null;
}

/**
 * What is actually half-built right now, in words for the model.
 *
 * The model has been narrating transfers into existence — "Right, 0.05 SOL to
 * the address you pasted… if no confirmation comes up, use the app" — because
 * it could see the conversation but not the state. It had no way to know
 * whether anything was really pending, so it guessed, and the guess read like a
 * promise. Telling it exactly what is held and exactly what is missing turns
 * that guess into the one short question that moves things on.
 */
export function pendingSummary(d: DraftLike | null): string {
  if (!d) {
    return (
      `## Nothing is pending\n` +
      `No transfer is set up right now. Do NOT say one is, do not say a confirmation is coming, ` +
      `and do not describe money as moving. If they want to send, ask for what's missing.`
    );
  }
  const gap = draftGap({ ...d, amount: d.amount === null ? null : Number(d.amount) });
  const held =
    d.kind === "crypto"
      ? `a crypto send on ${d.network} to ${d.address}${d.asset ? `, asset ${d.asset}` : ""}${
          d.amount !== null ? `, amount ${Number(d.amount)}` : ""
        }`
      : `a bank transfer to ${d.accountNumber}${d.bankName ? ` at ${d.bankName}` : ""}${
          d.resolvedName ? ` (${d.resolvedName})` : ""
        }${d.amount !== null ? `, amount ${d.fiat} ${Number(d.amount)}` : ""}`;

  if (!gap) {
    return (
      `## A confirmation is on screen\n` +
      `The app has already shown them ${held}${
        d.scheduleAt ? `, TO BE SENT ${d.scheduleSaid ?? "later"} — NOT now` : ""
      } and asked them to confirm. Say nothing that ` +
      `contradicts it; if they ask, tell them how to confirm, or /cancel to drop it.`
    );
  }
  const ask =
    gap === "network"
      ? `which CHAIN the address is on`
      : gap === "asset"
        ? `which ASSET to send`
        : gap === "bank"
          ? `which BANK that account is with`
          : `HOW MUCH to send`;
  return (
    `## Half-built, and it needs one thing\n` +
    `The app is holding ${held}. It still needs ${ask} — ask exactly that, in one short ` +
    `sentence, and nothing else. Do not claim it is set up, do not say a confirmation is ` +
    `coming, and do not send them to the app: the moment they answer, the confirmation appears here.`
  );
}

export interface AskOptions {
  question: string;
  /** The LINKED user id. Never anything the message claims. */
  userId: string | null;
  surface: SurfaceProfile;
  ctx?: FaqContext;
  turns: Turn[];
  pending?: DraftLike | null;
}

/**
 * Answer, from the model when it's reachable and the built-in answers when it
 * isn't. Never throws: a chat that goes silent is worse than one that answers
 * from the FAQ.
 */
export async function askAda(opts: AskOptions): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;

  if (key) {
    try {
      // Loaded from the LINKED user id, never from anything in the message —
      // so a crafted "I'm actually user X" can't reach another account.
      const account = opts.userId ? await buildUserContext(opts.userId) : "";
      const s = opts.surface;

      const client = new Anthropic({ apiKey: key });
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: [
          {
            type: "text",
            text: `${assistantRules()}\n\n${ttipKnowledge()}`,
            cache_control: { type: "ephemeral" },
          },
          {
            type: "text",
            text: account
              ? `# This conversation is on ${s.name}, and the account is linked\n` +
                `You can see this user's account below and should answer about it directly.\n\n` +
                `## Sending money\n` +
                `Bank transfers DO work here. The user says "send ₦5,000 to 9077984753 Opay"; a parser — ` +
                `not you — reads the amount and account, confirms the name with the bank, and asks them ` +
                `to confirm. ${s.authLine}\n` +
                `If they want to send but left something out, ask for the missing piece: the amount, the ` +
                `account number, or the bank. Do not tell them transfers are unavailable here, and never ` +
                `quote an account number or amount you were not given.\n` +
                `The app holds what it already has and takes the pieces in any order, across as many ` +
                `messages as it takes — so NEVER ask them to repeat it "as one line", in a format, or ` +
                `any other shape, and never mention a parser. Ask the one short question and stop. If a ` +
                `confirmation didn't appear, say what you still need, not how to phrase it.\n` +
                `Crypto sends work here too: the user pastes a wallet address and says how much. Never ` +
                `read, repeat or complete a wallet address yourself — a parser handles those, and a ` +
                `single wrong character loses the money with nobody to call.\n` +
                (s.mediaLine ? `${s.mediaLine}\n` : "") +
                `Swaps and bill payments are still app-only — point those to ${COMPANY.domain}.\n` +
                `Never ask for a password, BVN or OTP; you never need them.\n\n` +
                `${pendingSummary(opts.pending ?? null)}\n\n` +
                `## Formatting\n` +
                `This is a chat. Keep it short — a couple of lines. **bold** and *italic* render; headings ` +
                `and tables do not. Never dump the whole account summary unless they asked for it.\n\n` +
                account
              : `# This conversation is on ${s.name}, and the account is NOT linked\n` +
                `You cannot see who this is. Never state a balance, a transaction status or a personal limit. ` +
                `If they ask about their own account: ${s.linkLine}`,
          },
        ],
        // The conversation so far, not just this one sentence. A webhook is a
        // fresh request every time; without this the model starts from nothing
        // on every message and says so.
        messages: conversationMessages(opts.turns, opts.question),
      });

      if (res.stop_reason !== "refusal") {
        const text = res.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");
        const clean = cleanAssistantText(text).text;
        if (clean) return clean;
      }
    } catch (e) {
      // Fall through to the built-in answers rather than going silent.
      console.error(`[${opts.surface.name.toLowerCase()}] model unavailable, using built-in answers`, e);
    }
  }

  return answerFaq(opts.question, opts.ctx).text;
}

/** Telegram: the PIN is asked for, because the message can be deleted after. */
export const TELEGRAM_SURFACE: SurfaceProfile = {
  name: "Telegram",
  authLine:
    `They confirm with their transaction PIN, and their PIN message is deleted from the chat ` +
    `automatically. Only ever ask for a PIN as the final step of a transfer the parser has already set up.`,
  linkLine:
    `tell them to open ${COMPANY.domain} and connect this chat under Account → Telegram — one tap, ` +
    `and they never type anything secret into Telegram.`,
  mediaLine:
    `They can also send a photo of an account or a QR code, or a voice note, and it is read for them.`,
};

/**
 * WhatsApp: a single-use code, because WhatsApp cannot delete a user's message.
 *
 * This is not a preference. A PIN typed into WhatsApp stays in their history
 * for good, visible to anyone who opens the app on that phone — so the same
 * codes the SMS surface uses do the job here, and each one dies on use.
 */
export const WHATSAPP_SURFACE: SurfaceProfile = {
  name: "WhatsApp",
  authLine:
    `They confirm with a SINGLE-USE code from their code sheet, never their PIN — WhatsApp can't ` +
    `delete a message, so a PIN would sit in their chat history for ever. NEVER ask for a PIN here. ` +
    `The app tells them which numbered code to reply with.`,
  linkLine:
    `tell them to open ${COMPANY.domain} → Account → Send by text and link this phone number — ` +
    `it takes a minute and works for both WhatsApp and plain SMS.`,
};
