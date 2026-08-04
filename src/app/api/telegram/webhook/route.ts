import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { sendMessage, sendTyping, deleteMessage, downloadFile, telegramEnabled, telegramWebhookSecret, telegramWelcome } from "@/lib/telegram";
import { parseTransferIntent, parseBankName, parseAmount } from "@/lib/assistant/intent";
import { extractPaymentFromImage, imageMediaType } from "@/lib/assistant/vision";
import { speechEnabled, transcribe } from "@/lib/assistant/speech";
import { prisma } from "@/lib/db";
import { NIGERIAN_BANKS } from "@/lib/banks";
import {
  createDraft,
  liveDraft,
  clearDraft,
  draftPrompt,
  sendDraft,
  bumpAttempts,
  MAX_PIN_ATTEMPTS,
} from "@/lib/telegram-transfer";
import { answerFaq } from "@/lib/assistant/faq";
import { assistantRules, ttipKnowledge } from "@/lib/assistant/knowledge";
import { cleanAssistantText } from "@/lib/assistant/sanitize";
import { buildUserContext } from "@/lib/assistant/context";
import { redeemLinkToken, userForChat, unlinkChat } from "@/lib/telegram-link";
import { bankAliases } from "@/lib/bank-aliases";
import { rateLimit } from "@/lib/rate-limit";
import { COMPANY } from "@/lib/company";

/**
 * The Ttip Telegram bot.
 *
 * Same brain as Ada in the app — the model when a key is configured, the
 * built-in answers when it isn't.
 *
 * A raw Telegram chat id proves nothing: anyone can message a bot. So the bot
 * knows who it's talking to ONLY when that chat has been linked from inside the
 * signed-in app (see lib/telegram-link.ts), which is proof, not a claim. Linked,
 * Ada answers about the real account. Unlinked, she answers product questions
 * and offers the one-tap link instead of pretending she can see anything.
 *
 * A linked chat can send a bank transfer — by typing it, by photographing the
 * vendor's account details, or by saying it out loud. All three converge on the
 * same code: a parser reads the amount and account, the BANK confirms who owns
 * it, and the user enters a PIN that is deleted from the chat the moment it's
 * read. Swaps, bills and crypto withdrawals stay in the app.
 *
 * Telegram retries any non-2xx, so this always returns 200 once the update has
 * been accepted; failures are logged, not bounced back into a retry loop.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MODEL = "claude-opus-5";
const MAX_TOKENS = 1200;

interface Update {
  message?: {
    message_id?: number;
    chat?: { id?: number };
    from?: { id?: number; username?: string };
    text?: string;
    caption?: string;
    /** Telegram sends several sizes, smallest first. */
    photo?: { file_id: string; file_size?: number }[];
    /** A photo sent as a file rather than compressed. */
    document?: { file_id: string; mime_type?: string };
    voice?: { file_id: string; mime_type?: string };
    audio?: { file_id: string; mime_type?: string };
    video_note?: { file_id: string };
  };
}

/** A message that is nothing but 4–6 digits — i.e. a PIN. */
const LOOKS_LIKE_PIN = /^\d{4,6}$/;

async function reply(question: string, userId: string | null, ctx: FaqCtx): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;

  if (key) {
    try {
      // Loaded from the LINKED user id, never from anything in the message —
      // so a crafted "I'm actually user X" can't reach another account.
      const account = userId ? await buildUserContext(userId) : "";

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
              ? `# This conversation is on Telegram, and the account is linked\n` +
                `You can see this user's account below and should answer about it directly.\n\n` +
                `## Sending money\n` +
                `Bank transfers DO work here. The user says "send ₦5,000 to 9077984753 Opay"; a parser — ` +
                `not you — reads the amount and account, confirms the name with the bank, and asks for ` +
                `their PIN. Their PIN message is deleted from the chat automatically.\n` +
                `If they want to send but left something out, ask for the missing piece: the amount, the ` +
                `account number, or the bank. Do not tell them transfers are unavailable here, and never ` +
                `quote an account number or amount you were not given.\n` +
                `Swaps, bill payments and crypto withdrawals are still app-only — point those to ` +
                `${COMPANY.domain}.\n` +
                `Never ask for a password, BVN or OTP; you never need them. Only ever ask for a PIN as the ` +
                `final step of a transfer the parser has already set up.\n\n` +
                `## Formatting\n` +
                `This is a chat. Keep it short — a couple of lines. **bold** and *italic* render; headings ` +
                `and tables do not. Never dump the whole account summary unless they asked for it.\n\n` +
                account
              : `# This conversation is on Telegram, and the account is NOT linked\n` +
                `You cannot see who this is. Never state a balance, a transaction status or a personal limit. ` +
                `If they ask about their own account, tell them to open ${COMPANY.domain} and connect this ` +
                `chat under Account → Telegram — one tap, and they never type anything secret into Telegram.`,
          },
        ],
        messages: [{ role: "user", content: question }],
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
      console.error("[telegram] model unavailable, using built-in answers", e);
    }
  }

  return answerFaq(question, ctx).text;
}

type FaqCtx = Parameters<typeof answerFaq>[1];

/** `/start <token>` — the deep link from the app. */
async function handleStart(chatId: number, arg: string, username?: string): Promise<string> {
  if (!arg) {
    const linked = await userForChat(chatId);
    return telegramWelcome(linked?.name);
  }

  const res = await redeemLinkToken(arg, chatId, username);
  if (res.ok) {
    return (
      `Connected ✅ — you're signed in as ${res.name}.\n\n` +
      `You can now ask me about your own account: your balance, your limits, your account number, ` +
      `or why a transfer is still pending.\n\n` +
      `Moving money stays in the app at ${COMPANY.domain}. /unlink disconnects this chat whenever you want.`
    );
  }

  switch (res.reason) {
    case "expired":
      return `That link has expired — they only last a few minutes for safety. Open ${COMPANY.domain}, go to Account → Telegram and tap Connect for a fresh one.`;
    case "used":
      return `That link has already been used. Each one works once — grab a new one from Account → Telegram in the app.`;
    case "chat_taken":
      return `This Telegram account is already connected to a different ${COMPANY.product} account. Send /unlink here first, then try again.`;
    default:
      return `I couldn't read that link. Open ${COMPANY.domain} → Account → Telegram and tap Connect to get a working one.`;
  }
}

/**
 * A photo or a voice note, turned into the sentence the user meant.
 *
 * Returns the text to carry on with, "" when the message has already been
 * answered, or null when there was nothing usable.
 *
 * The market case this exists for: you photograph a vendor's account details
 * rather than typing ten digits standing up in a hurry, and you say what to
 * send rather than typing that either. Both paths converge on the same
 * sentence, so a photo and a typed message go through identical checks — the
 * bank still confirms the name, and you still enter your PIN.
 */
async function handleMedia(chatId: number, m: NonNullable<Update["message"]>): Promise<string | null> {
  const linked = await userForChat(chatId);
  const caption = (m.caption ?? "").trim();

  // ---- Voice ----
  const voice = m.voice ?? m.audio;
  if (voice) {
    if (!speechEnabled()) {
      await sendMessage(
        chatId,
        "I can't listen to voice notes yet — type it instead and I'll do it right away.",
      );
      return "";
    }
    await sendTyping(chatId);
    const file = await downloadFile(voice.file_id);
    const said = file ? await transcribe(file.buffer, voice.mime_type ?? file.mime ?? "audio/ogg") : null;
    if (!said) {
      await sendMessage(chatId, "I couldn't make that out — say it again, or type it.");
      return "";
    }
    // Echo it back. A misheard amount has to be visible BEFORE the PIN, not
    // discovered afterwards.
    await sendMessage(chatId, `I heard: *${said}*`);
    return said;
  }

  // ---- Photo ----
  const photoId =
    m.photo?.length
      ? m.photo[m.photo.length - 1].file_id // last entry is the largest
      : m.document && imageMediaType(m.document.mime_type)
        ? m.document.file_id
        : null;

  if (!photoId) return null;

  if (!linked) {
    await sendMessage(
      chatId,
      `I can read account details off a photo, but I need to know whose account is paying first. Open ${COMPANY.domain} → Account → Telegram and tap Connect.`,
    );
    return "";
  }

  await sendTyping(chatId);
  const file = await downloadFile(photoId);
  const mediaType = imageMediaType(m.document?.mime_type ?? file?.mime ?? "image/jpeg");
  if (!file || !mediaType) {
    await sendMessage(chatId, "I couldn't open that image. Try again, or type the account number and bank.");
    return "";
  }

  const found = await extractPaymentFromImage(file.buffer.toString("base64"), mediaType);
  if (!found.accountNumber) {
    await sendMessage(
      chatId,
      "I couldn't read an account number from that clearly enough to trust it — and I'd rather ask than guess with your money. Type the number and bank, or send a sharper photo.",
    );
    return "";
  }

  // The amount can come from the caption ("send 7k to this") or from the image
  // itself (an invoice). Neither is assumed — if there's no amount, we ask.
  const amount = parseAmount(caption) ?? found.amount;
  const bank = parseBankName(caption, NIGERIAN_BANKS.map((b) => b.name)) ?? found.bankName;

  if (!bank) {
    await sendMessage(
      chatId,
      `I read the account number **${found.accountNumber}** but not the bank. Which bank is it?`,
    );
    return "";
  }
  if (!amount) {
    await sendMessage(
      chatId,
      `Got it — **${found.accountNumber}** at **${bank}**${found.printedName ? ` (${found.printedName})` : ""}.\n\nHow much should I send?`,
    );
    return "";
  }

  await createDraft({ userId: linked.id, chatId, amount, fiat: "NGN", accountNumber: found.accountNumber, bankName: bank });
  const draft = await liveDraft(chatId);
  if (draft) await sendMessage(chatId, draftPrompt(draft));
  return "";
}

/**
 * "Send 5k to 9077984753 Opay".
 *
 * Returns true when it took the message. The amount, the account number and
 * the bank all come from the parser rather than the model — a number the model
 * reconstructed is a number that can be reconstructed wrong, and this one moves
 * money. The bank is then asked who owns the account, and the name goes in the
 * confirmation, so the user sees who they are actually paying before the PIN.
 */
/**
 * Find a saved account by the name the user calls it.
 *
 * Matched on whole words so "sister" can't be found inside another word, and
 * only returned when exactly ONE beneficiary matches — two candidates means we
 * ask rather than pick, because picking wrong sends money to the wrong person.
 * A beneficiary with no bank recorded is skipped: we can't pay it.
 */
async function matchBeneficiary(userId: string, text: string) {
  const saved = await prisma.beneficiary.findMany({ where: { userId, type: "bank" } });
  const usable = saved.filter((b) => b.handle && b.detail);
  if (!usable.length) return null;

  const q = text.toLowerCase();
  const hits = usable.filter((b) =>
    b.name
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 3)
      .some((w) => new RegExp(`(^|\\W)${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}('?s)?(\\W|$)`).test(q)),
  );
  return hits.length === 1 ? hits[0] : null;
}

async function handleTransferIntent(chatId: number, userId: string, text: string): Promise<boolean> {
  const intent = parseTransferIntent(text);
  if (!intent || !intent.amount) return false;

  const fiat = "NGN";

  // "Send 7k to my sister's account" — a saved beneficiary, by whatever name
  // the user gave it. This is how people actually refer to accounts they use;
  // nobody remembers a NUBAN for someone they pay every week.
  if (!intent.account) {
    const named = await matchBeneficiary(userId, text);
    if (named) {
      await createDraft({
        userId,
        chatId,
        amount: intent.amount,
        fiat,
        accountNumber: named.detail,
        bankName: named.handle!,
      });
      const draft = await liveDraft(chatId);
      if (draft) await sendMessage(chatId, draftPrompt(draft));
      return true;
    }

    const saved = await prisma.beneficiary.findMany({
      where: { userId, type: "bank" },
      select: { name: true },
      take: 12,
    });
    const listed = saved.length
      ? ` You have ${saved.map((b) => b.name).join(", ")} saved — say which one.`
      : "";
    await sendMessage(
      chatId,
      `I can send that — which account?${listed} Or paste it like *"send ₦${intent.amount.toLocaleString(
        "en-US",
      )} to 9077984753 Opay"* and I'll check the name before anything moves.`,
    );
    return true;
  }

  const bankName = parseBankName(text, NIGERIAN_BANKS.map((b) => b.name));
  if (!bankName) {
    await sendMessage(
      chatId,
      `Which bank is ${intent.account}? Say it like *"send ₦${intent.amount.toLocaleString(
        "en-US",
      )} to ${intent.account} Opay"* and I'll confirm the name first.`,
    );
    return true;
  }

  await createDraft({ userId, chatId, amount: intent.amount, fiat, accountNumber: intent.account, bankName });

  const draft = await liveDraft(chatId);
  if (draft) await sendMessage(chatId, draftPrompt(draft));
  return true;
}

/**
 * A PIN arrived for a pending transfer. The message is already deleted by the
 * time we get here — that happens first, unconditionally.
 */
async function handlePin(
  chatId: number,
  pin: string,
  draft: NonNullable<Awaited<ReturnType<typeof liveDraft>>>,
  wiped: boolean,
): Promise<void> {
  // If Telegram wouldn't let us delete it, say so plainly rather than let the
  // user believe a PIN they can still scroll to has been removed.
  const notWiped = wiped
    ? ""
    : `\n\n⚠️ I couldn't delete your PIN message — please delete it yourself.`;

  const res = await sendDraft(draft, pin);

  if (res.ok) {
    await clearDraft(chatId);
    await sendMessage(chatId, res.message + notWiped);
    return;
  }

  if (res.wrongPin) {
    const attempts = await bumpAttempts(chatId).catch(() => MAX_PIN_ATTEMPTS);
    if (attempts >= MAX_PIN_ATTEMPTS) {
      await clearDraft(chatId);
      await sendMessage(
        chatId,
        `That PIN was wrong too many times, so I've cancelled the transfer. Nothing was sent. Start again when you're ready.` + notWiped,
      );
      return;
    }
    await sendMessage(
      chatId,
      `That PIN isn't right — ${MAX_PIN_ATTEMPTS - attempts} ${
        MAX_PIN_ATTEMPTS - attempts === 1 ? "try" : "tries"
      } left. Send it again, or /cancel.` + notWiped,
    );
    return;
  }

  // Anything else — limits, insufficient balance, an ambiguous provider
  // response — is reported as-is and the draft is dropped so a retyped PIN
  // can't fire it again.
  await clearDraft(chatId);
  await sendMessage(chatId, res.message + notWiped);
}

export async function POST(req: Request) {
  if (!telegramEnabled()) return NextResponse.json({ ok: true });

  // Reject anything that isn't Telegram. Without this, the URL alone is enough
  // for anyone to drive the bot.
  const secret = telegramWebhookSecret();
  if (secret && req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ ok: true });
  }

  let update: Update;
  try {
    update = (await req.json()) as Update;
  } catch {
    return NextResponse.json({ ok: true });
  }

  const chatId = update.message?.chat?.id;
  const messageId = update.message?.message_id;
  let text = (update.message?.text ?? "").trim();
  if (!chatId) return NextResponse.json({ ok: true });

  // A photo of an account, or a voice note. Both end up as the same thing: a
  // request in words, handled by exactly the code a typed message goes through.
  const media = update.message;
  if (!text && (media?.photo?.length || media?.voice || media?.audio || media?.document)) {
    try {
      const handled = await handleMedia(chatId, media);
      if (handled !== null) text = handled;
    } catch (e) {
      console.error("[telegram] media failed", e);
      await sendMessage(chatId, "I couldn't open that. Try sending it again, or type the details.");
      return NextResponse.json({ ok: true });
    }
    if (!text) return NextResponse.json({ ok: true });
  }

  if (!text) return NextResponse.json({ ok: true });

  // A PIN gets deleted from the chat BEFORE anything else happens — before the
  // rate limiter, before the transfer, before any await that could fail. The
  // user should never have to remember to remove it, and it must be gone even
  // if everything after this line goes wrong.
  if (LOOKS_LIKE_PIN.test(text) && messageId) {
    const draft = await liveDraft(chatId);
    if (draft) {
      const wiped = messageId ? await deleteMessage(chatId, messageId) : false;
      await handlePin(chatId, text, draft, wiped);
      return NextResponse.json({ ok: true });
    }
  }

  try {
    // Per-chat throttle: the model costs money and a bot is trivially spammable.
    rateLimit(`telegram:${chatId}`, { limit: 12, windowMs: 60_000 });
  } catch {
    await sendMessage(chatId, "You're going a bit fast — give me a minute and try again.");
    return NextResponse.json({ ok: true });
  }

  const [command, ...rest] = text.split(/\s+/);
  const arg = rest.join(" ").trim();

  try {
    if (command === "/start") {
      await sendMessage(chatId, await handleStart(chatId, arg, update.message?.from?.username));
      return NextResponse.json({ ok: true });
    }

    if (command === "/unlink") {
      const done = await unlinkChat(chatId);
      await sendMessage(
        chatId,
        done
          ? `Disconnected. I can't see your account from this chat any more — I'll still answer questions about ${COMPANY.product}.`
          : `This chat isn't connected to a ${COMPANY.product} account, so there's nothing to disconnect.`,
      );
      return NextResponse.json({ ok: true });
    }

    const linked = await userForChat(chatId);

    if (command === "/cancel") {
      await clearDraft(chatId);
      await sendMessage(chatId, "Cancelled — nothing was sent.");
      return NextResponse.json({ ok: true });
    }

    if (command === "/help") {
      await sendMessage(chatId, telegramWelcome(linked?.name));
      return NextResponse.json({ ok: true });
    }

    // "Who am I here?" — worth its own answer, because the whole point of the
    // link is that the answer stops being "I don't know".
    if (command === "/account" || command === "/me") {
      await sendMessage(
        chatId,
        linked
          ? `You're connected as ${linked.name} (@${linked.username}).`
          : `This chat isn't connected yet. Open ${COMPANY.domain} → Account → Telegram and tap Connect.`,
      );
      return NextResponse.json({ ok: true });
    }

    await sendTyping(chatId);

    // "Send 5k to 9077984753 Opay" — set the transfer up and ask for the PIN.
    // Handled before the model, so the amount and the account come from a
    // parser, never from something the model reconstructed.
    if (linked) {
      const handled = await handleTransferIntent(chatId, linked.id, text);
      if (handled) return NextResponse.json({ ok: true });
    }

    const ctx: FaqCtx = linked
      ? {
          name: linked.name,
          tier: linked.kycTier,
          kycStatus: linked.kycStatus,
          nairaAccount: linked.nairaAccount,
          nairaBank: linked.nairaBank,
          bankAliases: bankAliases(linked.nairaBank),
        }
      : {};

    await sendMessage(chatId, await reply(text.replace(/^\/\w+\s*/, ""), linked?.id ?? null, ctx));
  } catch (e) {
    console.error("[telegram] reply failed", e);
    await sendMessage(chatId, "Something went wrong on my side — try again in a moment.");
  }

  return NextResponse.json({ ok: true });
}
