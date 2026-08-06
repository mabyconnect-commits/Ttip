import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { whatsappConfig, sendWhatsApp, verifyWhatsAppSignature, markWhatsAppRead } from "@/lib/whatsapp";
import { normalisePhone } from "@/lib/sms/provider";
import { nextCodeIndex, spendCode, codesLeft, LOW_CODES } from "@/lib/sms/codes";
import { withinCaps } from "@/lib/sms/limits";
import { sentByChatToday, sendChatTransfer } from "@/lib/sms/session";
import { askAda, WHATSAPP_SURFACE } from "@/lib/assistant/brain";
import { rememberTurn, recentTurns } from "@/lib/telegram-memory";
import { parseTransferIntent, parseBankName, parseAmount, transferParts } from "@/lib/assistant/intent";
import { fillFromReply, draftGap } from "@/lib/assistant/draft-fill";
import { NIGERIAN_BANKS } from "@/lib/banks";
import {
  createDraft,
  liveDraft,
  clearDraft,
  draftPrompt,
  setDraftAmount,
  setDraftBank,
  setDraftSchedule,
  scheduleDraft,
  PRE_AUTHORISED,
} from "@/lib/telegram-transfer";
import { parseWhen, scheduleProblem } from "@/lib/assistant/when";
import { mentionsCrypto, parseCryptoAsset, parseCryptoAddress } from "@/lib/assistant/crypto-address";
import { COMPANY } from "@/lib/company";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Ada on WhatsApp.
 *
 * The same assistant as Telegram — one brain, in lib/assistant/brain.ts — and
 * the same payout path, through /api/send. What is genuinely different is how a
 * transfer is confirmed, and it is different for one concrete reason: WhatsApp
 * cannot delete a user's message.
 *
 * Telegram asks for the PIN because it deletes that message the instant it
 * reads it. Here a PIN would live in the user's chat history for good, readable
 * by anyone who picks up the phone. So a transfer is confirmed with a
 * SINGLE-USE code from the sheet the user already has for SMS — spent on use,
 * asked for by number, worthless the moment it is read.
 *
 * Identity comes from Meta: `wa_id` is a phone number Meta has verified. If it
 * matches a phone the user linked in the app, that is the same proof the SMS
 * surface relies on, and there is no second dance to do.
 */

const CHAT_KEY = (phone: string) => `wa:${phone}`;

/** Meta's webhook handshake. */
export async function GET(req: Request) {
  const cfg = whatsappConfig();
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (cfg && mode === "subscribe" && token === cfg.verifyToken && challenge) {
    return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

interface WaMessage {
  id?: string;
  from?: string;
  type?: string;
  text?: { body?: string };
}

export async function POST(req: Request) {
  // Always 200 once accepted. Meta retries anything else, and a retried money
  // instruction is worse than a dropped one.
  try {
    const raw = await req.text();
    if (!verifyWhatsAppSignature(raw, req.headers.get("x-hub-signature-256"))) {
      console.error("[whatsapp] signature check failed — dropping");
      return NextResponse.json({ ok: true });
    }

    const body = JSON.parse(raw) as {
      entry?: { changes?: { value?: { messages?: WaMessage[] } }[] }[];
    };
    const msg = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg?.from || !msg.id) return NextResponse.json({ ok: true });

    // Delivery receipts and read receipts arrive here too; only real inbound
    // messages are instructions.
    if (msg.type !== "text" || !msg.text?.body?.trim()) {
      if (msg.type) {
        await sendWhatsApp(
          msg.from,
          `I can only read text here for now — photos and voice notes work on Telegram. ` +
            `Type it and I'll set it up.`,
        );
      }
      return NextResponse.json({ ok: true });
    }

    // Meta retries a delivery it thinks failed. The message id is stable, so
    // recording it is what stops one instruction becoming two transfers.
    const seen = await prisma.smsCommand.findUnique({ where: { providerId: `wa:${msg.id}` } });
    if (seen) return NextResponse.json({ ok: true, duplicate: true });

    const phone = normalisePhone(msg.from) ?? `+${msg.from.replace(/\D/g, "")}`;
    const text = msg.text.body.trim();
    void markWhatsAppRead(msg.id);

    const out = await handle(phone, text);

    await prisma.smsCommand
      .create({
        data: {
          providerId: `wa:${msg.id}`,
          phone,
          body: text.slice(0, 320),
          userId: out.userId ?? null,
          outcome: out.outcome,
          reply: out.text?.slice(0, 320) ?? null,
        },
      })
      .catch(() => {
        /* a retry racing us — the reply is already going out */
      });

    if (out.text) {
      await sendWhatsApp(msg.from, out.text);
      await rememberTurn(CHAT_KEY(phone), "assistant", out.text);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[whatsapp] webhook failed", e);
    return NextResponse.json({ ok: true });
  }
}

interface Handled {
  outcome: string;
  text?: string;
  userId?: string;
}

const NOT_LINKED = (phone: string) =>
  `Hi 👋 I'm Ada, ${COMPANY.product}'s assistant.\n\n` +
  `I can't see an account for ${phone} yet. Open ${COMPANY.domain} → Account → Send by text and link ` +
  `this number — it takes a minute, and it works for WhatsApp and plain SMS.\n\n` +
  `Ask me anything about ${COMPANY.product} in the meantime.`;

async function handle(phone: string, text: string): Promise<Handled> {
  try {
    rateLimit(`wa:${phone}`, { limit: 20, windowMs: 60_000 });
  } catch {
    return { outcome: "rate-limited", text: "You're going a bit fast — give me a moment." };
  }

  const chatId = CHAT_KEY(phone);
  await rememberTurn(chatId, "user", text);

  // Identity: a phone Meta verified, matched against one the user linked in the
  // app. Never anything the message itself claims.
  const link = await prisma.phoneLink.findUnique({ where: { phone } });
  const userId = link?.verifiedAt ? link.userId : null;

  if (!userId) {
    // Still useful: product questions get real answers, and the unlinked prompt
    // stops Ada inventing an account she cannot see.
    if (/^(hi|hello|hey|start|menu)\b/i.test(text)) return { outcome: "unlinked-greeting", text: NOT_LINKED(phone) };
    const answer = await askAda({ question: text, userId: null, surface: WHATSAPP_SURFACE, turns: await recentTurns(chatId) });
    return { outcome: "unlinked", text: answer };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { defaultFiat: true, kycStatus: true, name: true },
  });
  if (!user) return { outcome: "no-user" };
  const fiat = user.defaultFiat;

  if (/^\/?cancel\b/i.test(text)) {
    await clearDraft(chatId);
    return { outcome: "cancelled", userId, text: "Cancelled — nothing was sent." };
  }

  const pending = await liveDraft(chatId);

  // A code answering "reply with code #7". Checked before anything else, so a
  // six-digit reply can never be read as an amount.
  const bareCode = text.match(/^(\d{4,8})$/);
  if (bareCode && pending && !draftGap({ ...pending, amount: pending.amount === null ? null : Number(pending.amount) })) {
    return confirmWithCode(chatId, userId, pending, bareCode[1]);
  }

  // Never a PIN here. If they send one anyway, say so — the message cannot be
  // taken back, and they need to know that before they type the next one.
  if (bareCode && !pending) {
    return {
      outcome: "stray-code",
      userId,
      text:
        `Nothing is waiting for a code right now.\n\n` +
        `⚠️ Never send your transaction PIN on WhatsApp — I'll never ask for it here, ` +
        `because I can't delete your message afterwards. Please delete that one.`,
    };
  }

  const built = await buildTransfer(chatId, userId, fiat, text, pending, user.kycStatus === "verified");
  if (built) return { ...built, userId };

  const answer = await askAda({
    question: text,
    userId,
    surface: WHATSAPP_SURFACE,
    turns: await recentTurns(chatId),
    pending: pending ?? null,
  });
  return { outcome: "answered", userId, text: answer };
}

/**
 * Turn what they said into a transfer, or add the missing piece to one.
 *
 * Deliberately the same parsers and the same draft helpers Telegram uses — a
 * second reading of "send 5k to 9077984753 Opay" is how two surfaces come to
 * disagree about who is being paid.
 */
async function buildTransfer(
  chatId: string,
  userId: string,
  fiat: string,
  text: string,
  pending: Awaited<ReturnType<typeof liveDraft>>,
  verified: boolean,
): Promise<Handled | null> {
  const banks = NIGERIAN_BANKS.map((b) => b.name);

  // A wallet address is a crypto send, and those stay on Telegram and the app:
  // this surface has no QR reader and no way to show an address safely at
  // length. Say so rather than starting something we can't finish.
  if (parseCryptoAddress(text)) {
    return {
      outcome: "crypto-elsewhere",
      text: `Crypto sends aren't on WhatsApp yet — use the app or Telegram, where I can check the address properly.`,
    };
  }

  const when = parseWhen(text);
  const problem = when ? scheduleProblem(when.at) : null;
  const later = when && !problem ? when : null;

  // Filling in a half-built one.
  if (pending && draftGap({ ...pending, amount: pending.amount === null ? null : Number(pending.amount) })) {
    const add = fillFromReply(
      { ...pending, amount: pending.amount === null ? null : Number(pending.amount) },
      text,
      banks,
    );
    let d = pending;
    let changed = false;
    if (later && !pending.scheduleAt) {
      d = await setDraftSchedule(chatId, later.at, later.said);
      changed = true;
    }
    if (add.bank) {
      d = (await setDraftBank(chatId, add.bank)) ?? d;
      changed = true;
    }
    if (add.amount) {
      d = await setDraftAmount(chatId, add.amount);
      changed = true;
    }
    if (changed) {
      const state = { ...d, amount: d.amount === null ? null : Number(d.amount) };
      return { outcome: "draft-filled", text: draftGap(state) ? missing(d) : await confirmPrompt(userId, d) };
    }
  }

  const intent = parseTransferIntent(text);
  const parts = transferParts(text);
  // Either half is enough to start: an amount to send, or an account to send
  // to. The other half becomes the one short question we ask next.
  if (!intent?.amount && !parts?.account) return null;

  if (!verified) {
    return {
      outcome: "unverified",
      text: `Verify your BVN before sending — ${COMPANY.domain} → Account → Verify. It takes about a minute.`,
    };
  }

  // Named an asset but no address: a crypto request, not a ₦0.05 bank transfer.
  if (intent?.amount && !intent.account && mentionsCrypto(text)) {
    return {
      outcome: "crypto-elsewhere",
      text: `That's ${intent.amount} ${parseCryptoAsset(text) ?? "crypto"} — crypto sends aren't on WhatsApp yet. Use the app or Telegram.`,
    };
  }

  const account = intent?.account ?? parts?.account;
  if (!account) return null;

  const bank = parseBankName(text, banks) ?? null;
  await createDraft({
    userId,
    chatId,
    amount: intent?.amount ?? parseAmount(text) ?? null,
    fiat,
    accountNumber: account,
    bankName: bank,
    scheduleAt: later?.at ?? null,
    scheduleSaid: later?.said ?? null,
  });

  const d = await liveDraft(chatId);
  if (!d) return { outcome: "draft-failed", text: "I couldn't set that up. Try again in a moment." };
  const state = { ...d, amount: d.amount === null ? null : Number(d.amount) };
  return { outcome: "draft-started", text: draftGap(state) ? missing(d) : await confirmPrompt(userId, d) };
}

function missing(d: {
  amount: unknown;
  accountNumber: string | null;
  bankName: string | null;
  resolvedName: string | null;
}): string {
  const who = `*${d.accountNumber}*${d.bankName ? ` at *${d.bankName}*` : ""}${d.resolvedName ? ` (${d.resolvedName})` : ""}`;
  if (!d.bankName) return `Got it — *${d.accountNumber}*.\n\nWhich bank is it?`;
  if (d.amount === null) return `Got it — ${who}.\n\nHow much should I send?`;
  return `Got it — ${who}.`;
}

/**
 * The confirmation, ending in a code rather than a PIN.
 *
 * draftPrompt writes the Telegram wording, which asks for a PIN — right there
 * and wrong here. The money lines are shared; the last line is not.
 */
async function confirmPrompt(
  userId: string,
  d: Parameters<typeof draftPrompt>[0],
): Promise<string> {
  const index = await nextCodeIndex(userId);
  if (index === null) {
    return `You're out of confirmation codes. Get a new sheet at ${COMPANY.domain} → Account → Send by text.`;
  }
  const body = draftPrompt(d)
    .split("\n")
    .filter((l) => !/transaction PIN|delete your PIN|\/cancel to drop it/i.test(l))
    .join("\n")
    .trim();

  return (
    `${body}\n\n` +
    `Reply with code *#${index}* from your sheet to confirm, or CANCEL.\n` +
    `_Never send your PIN here — I can't delete your messages, so I'll never ask for it._`
  );
}

/** Spend the code and send. */
async function confirmWithCode(
  chatId: string,
  userId: string,
  draft: NonNullable<Awaited<ReturnType<typeof liveDraft>>>,
  code: string,
): Promise<Handled> {
  const index = await nextCodeIndex(userId);
  if (index === null) {
    await clearDraft(chatId);
    return { outcome: "out-of-codes", userId, text: `You're out of codes. Get a new sheet at ${COMPANY.domain}.` };
  }

  if (!(await spendCode(userId, index, code))) {
    const tries = await prisma.telegramDraft
      .update({ where: { id: draft.id }, data: { attempts: { increment: 1 } }, select: { attempts: true } })
      .then((d) => d.attempts)
      .catch(() => 3);
    if (tries >= 3) {
      await clearDraft(chatId);
      return { outcome: "code-wrong-final", userId, text: "Wrong code too many times — cancelled. Nothing was sent." };
    }
    return { outcome: "code-wrong", userId, text: `That code isn't right. Reply with code *#${index}*, or CANCEL.` };
  }

  // Caps apply here exactly as they do on SMS: same code sheet, same strength
  // of authorisation, so the same ceiling.
  const amount = Number(draft.amount);
  const cap = withinCaps(amount, await sentByChatToday(userId), draft.fiat);
  if (!cap.ok) {
    await clearDraft(chatId);
    return { outcome: "over-cap", userId, text: `${cap.reason} (Your code was used, so use the next one next time.)` };
  }

  await clearDraft(chatId);

  const result = draft.scheduleAt
    ? await scheduleDraft(draft, PRE_AUTHORISED)
    : await sendChatTransfer(draft, "whatsapp");
  const left = await codesLeft(userId);
  const warn = left <= LOW_CODES ? `\n\n_${left} codes left — get more at ${COMPANY.domain}._` : "";
  return { outcome: result.ok ? "sent" : "send-failed", userId, text: result.message + warn };
}
