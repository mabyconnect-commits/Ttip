import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { sendMessage, sendTyping, deleteMessage, downloadFile, sendPhoto, telegramEnabled, telegramWebhookSecret, telegramWelcome } from "@/lib/telegram";
import { renderReceiptPng } from "@/lib/receipt-svg";
import { transferFee } from "@/lib/pricing";
import { parseTransferIntent, parseBankName, parseAmount, parseAccountNumber, transferParts } from "@/lib/assistant/intent";
import { fillFromReply, draftGap, wantsToProceed, assembleFromHistory } from "@/lib/assistant/draft-fill";
import { extractPaymentFromImage, imageMediaType, resolveImageType, isHeic } from "@/lib/assistant/vision";
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
  setDraftAmount,
  setDraftBank,
  setDraftAsset,
  setDraftNetwork,
  createCryptoDraft,
} from "@/lib/telegram-transfer";
import { parseCryptoAddress, parseCryptoAsset, mentionsCrypto, classify, parseEvmChain, networkFor, EVM_CHAIN_LABELS, FAMILY_ASSETS, shortAddress, type ChainFamily } from "@/lib/assistant/crypto-address";
import { decodeQr } from "@/lib/assistant/qr";
import { answerFaq } from "@/lib/assistant/faq";
import { assistantRules, ttipKnowledge } from "@/lib/assistant/knowledge";
import { cleanAssistantText } from "@/lib/assistant/sanitize";
import { buildUserContext } from "@/lib/assistant/context";
import { redeemLinkToken, userForChat, unlinkChat } from "@/lib/telegram-link";
import { rememberTurn, recentTurns, forgetChat } from "@/lib/telegram-memory";
import { conversationMessages } from "@/lib/assistant/conversation";
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

/**
 * Say something, and remember having said it.
 *
 * Everything Ada says in the money flow goes through here rather than straight
 * to sendMessage, because the next webhook is a fresh request: if "Got it —
 * 9136214038 at Moniepoint. How much should I send?" isn't written down, the
 * answer "1,200" arrives with nothing in front of it and she asks who all over
 * again. Recording is best-effort and never blocks the message.
 */
async function say(chatId: number | string, text: string): Promise<void> {
  await sendMessage(chatId, text);
  await rememberTurn(chatId, "assistant", text);
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
function pendingSummary(d: {
  kind?: string;
  amount: unknown;
  fiat: string;
  accountNumber: string | null;
  bankName: string | null;
  resolvedName: string | null;
  asset?: string | null;
  network?: string | null;
  address?: string | null;
} | null): string {
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
      `The app has already shown them ${held} and asked for their PIN. Say nothing that ` +
      `contradicts it; if they ask, tell them to reply with their PIN, or /cancel to drop it.`
    );
  }
  const ask =
    gap === "asset"
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

async function reply(
  chatId: number | string,
  question: string,
  userId: string | null,
  ctx: FaqCtx,
  pending?: Awaited<ReturnType<typeof liveDraft>>,
): Promise<string> {
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
                `The app holds what it already has and takes the pieces in any order, across as many ` +
                `messages as it takes — so NEVER ask them to repeat it "as one line", in a format, or ` +
                `any other shape, and never mention a parser. Ask the one short question and stop. If a ` +
                `confirmation didn't appear, say what you still need, not how to phrase it.\n` +
                `Crypto sends work here too: the user pastes a wallet address or sends a photo of ` +
                `a QR code, and says how much. Never read, repeat or complete a wallet address ` +
                `yourself — a decoder and a parser handle those, and a single wrong character ` +
                `loses the money with nobody to call.\n` +
                `Swaps and bill payments are still app-only — point those to ${COMPANY.domain}.\n` +
                `Never ask for a password, BVN or OTP; you never need them. Only ever ask for a PIN as the ` +
                `final step of a transfer the parser has already set up.\n\n` +
                `${pendingSummary(pending ?? null)}\n\n` +
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
        // The conversation so far, not just this one sentence. A webhook is a
        // fresh request every time; without this the model starts from nothing
        // on every message and says so.
        messages: conversationMessages(await recentTurns(chatId), question),
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
    // A new account on this chat starts a new conversation — whatever was said
    // before belongs to whoever was connected then.
    await forgetChat(chatId);
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
      await say(
        chatId,
        "I can't listen to voice notes yet — type it instead and I'll do it right away.",
      );
      return "";
    }
    await sendTyping(chatId);
    const file = await downloadFile(voice.file_id);
    const said = file ? await transcribe(file.buffer, voice.mime_type ?? file.mime ?? "audio/ogg") : null;
    if (!said) {
      await say(chatId, "I couldn't make that out — say it again, or type it.");
      return "";
    }
    // Echo it back. A misheard amount has to be visible BEFORE the PIN, not
    // discovered afterwards.
    await say(chatId, `I heard: *${said}*`);
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
    await say(
      chatId,
      `I can read account details off a photo, but I need to know whose account is paying first. Open ${COMPANY.domain} → Account → Telegram and tap Connect.`,
    );
    return "";
  }

  await sendTyping(chatId);
  const file = await downloadFile(photoId);
  if (!file) {
    await say(chatId, "I couldn't download that image. Send it again, or type the account number and bank.");
    return "";
  }

  // The bytes decide, not the header. Telegram's file server serves photos as
  // application/octet-stream, so trusting the declared type refused perfectly
  // good JPEGs with "I couldn't open that image".
  const mediaType = resolveImageType(file.buffer, m.document?.mime_type ?? file.mime);
  if (!mediaType) {
    await say(
      chatId,
      isHeic(file.buffer)
        ? "That's an iPhone HEIC photo, which I can't read. In Settings → Camera → Formats pick \"Most Compatible\", or send it as a screenshot instead."
        : "That file isn't an image I can read. Send a JPEG or PNG, or type the account number and bank.",
    );
    return "";
  }

  // A QR first. A decoder either returns the exact payload or fails, because a
  // QR carries its own checksum — whereas a model looking at one is guessing,
  // and a guessed crypto address is money gone with nobody to call.
  const qr = await decodeQr(file.buffer);
  if (qr) {
    const addr = parseCryptoAddress(qr);
    if (addr) {
      await handleCryptoAddress(chatId, linked.id, addr.address, addr.family, `${caption} ${qr}`);
      return "";
    }
    // A QR that isn't a wallet address may still be a bank account written out.
    const fromQr = parseAccountNumber(qr);
    if (fromQr) {
      const bank = parseBankName(`${caption} ${qr}`, NIGERIAN_BANKS.map((b) => b.name)) ?? null;
      const amt = parseAmount(caption);
      {
        await createDraft({ userId: linked.id, chatId, amount: amt, fiat: "NGN", accountNumber: fromQr, bankName: bank });
        const d = await liveDraft(chatId);
        if (d) await say(chatId, bank && amt ? draftPrompt(d) : missingPiece(d));
        return "";
      }
    }
  }

  const found = await extractPaymentFromImage(file.buffer.toString("base64"), mediaType);
  if (!found.accountNumber) {
    await say(
      chatId,
      "I couldn't read an account number from that clearly enough to trust it — and I'd rather ask than guess with your money. Type the number and bank, or send a sharper photo.",
    );
    return "";
  }

  // The amount can come from the caption ("send 7k to this") or from the image
  // itself (an invoice). Neither is assumed — if there's no amount, we ask.
  const amount = parseAmount(caption) ?? found.amount;
  const bank = parseBankName(caption, NIGERIAN_BANKS.map((b) => b.name)) ?? found.bankName;

  // Whatever the photo gave us is held — even just the number. Asking a
  // question and remembering nothing is what made the next answer land
  // nowhere; the account, the bank and the amount can now arrive in any order.
  await createDraft({
    userId: linked.id,
    chatId,
    amount,
    fiat: "NGN",
    accountNumber: found.accountNumber,
    bankName: bank ?? null,
  });
  const draft = await liveDraft(chatId);
  if (draft) await say(chatId, draft.bankName && draft.amount !== null ? draftPrompt(draft) : missingPiece(draft));
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

/**
 * A wallet address in the message — pasted, or decoded from a QR.
 *
 * Crypto has no recall and no name to check, so this asks about anything it
 * isn't sure of rather than choosing for the user: which asset, if they hold
 * more than one on that chain, and how much.
 */
async function handleCryptoAddress(
  chatId: number,
  userId: string,
  address: string,
  family: ChainFamily,
  text: string,
): Promise<boolean> {
  // The chain the USER named, not the one the address shape suggests. An 0x
  // address is valid on Ethereum, Arbitrum, Base, Polygon and every other EVM
  // rail; "this Arbitrum wallet" used to be confirmed as an Ethereum send
  // because one shape was read as one chain.
  const network = networkFor(family, text);
  const where = network ? `**${network}**` : "an **EVM**";

  // Only assets they actually hold on that chain — offering to send something
  // with a zero balance wastes a step and reads as a bug.
  const balances = await prisma.balance.findMany({
    where: { userId, kind: "crypto", symbol: { in: FAMILY_ASSETS[family] } },
    select: { symbol: true, amount: true },
  });
  const held = balances.filter((b) => Number(b.amount) > 0).map((b) => b.symbol);

  if (!held.length) {
    await say(
      chatId,
      `That's ${where} address, but you don't hold anything on it to send. ` +
        `Swap into ${FAMILY_ASSETS[family][0]} in the app first.`,
    );
    return true;
  }

  // A named asset wins; otherwise only pick when there's nothing to pick between.
  // By ticker or by name — a voice note says "Solana", never "SOL".
  const named = parseCryptoAsset(text, held);
  const asset = named ?? (held.length === 1 ? held[0] : null);
  const amount = parseAmount(text);

  // Everything known so far is stored before every question. Storing nothing
  // here is what broke the QR flow: the address was thrown away with the
  // question, so "0.05 Solana" came back to a bot holding nothing, fell through
  // to the naira parser and was offered as a ₦5 bank transfer.
  await createCryptoDraft({ userId, chatId, amount, asset, network: network ?? null, address });

  // Chain first — it decides which assets are even sendable there.
  if (!network) {
    await say(
      chatId,
      `That address works on several chains, and they're not the same money — ` +
        `\`${shortAddress(address)}\`.\n\n` +
        `Which network: ${EVM_CHAIN_LABELS.join(", ")}?`,
    );
    return true;
  }

  if (!asset) {
    await say(
      chatId,
      `That's a **${network}** address — \`${shortAddress(address)}\`.\n\n` +
        `Which do you want to send: ${held.join(", ")}?`,
    );
    return true;
  }

  if (!amount) {
    await say(
      chatId,
      `**${asset}** on **${network}**, to:\n\`${address}\`\n\nHow much ${asset} should I send?`,
    );
    return true;
  }
  const draft = await liveDraft(chatId);
  if (draft) await say(chatId, draftPrompt(draft));
  return true;
}

/**
 * Ask for the one thing still missing — and show what is already held.
 *
 * Repeating the account back matters: it is how the user knows Ada kept it,
 * and it is their chance to catch a digit the transcriber invented.
 */
function missingPiece(d: {
  kind?: string;
  amount: unknown;
  accountNumber: string | null;
  bankName: string | null;
  resolvedName: string | null;
  asset?: string | null;
  network?: string | null;
  address?: string | null;
}): string {
  if (d.kind === "crypto") {
    if (!d.network) {
      return (
        `Holding that address: \`${shortAddress(d.address ?? "")}\`.\n\n` +
        `Which network: ${EVM_CHAIN_LABELS.join(", ")}?`
      );
    }
    const where = `**${d.network}** — \`${shortAddress(d.address ?? "")}\``;
    if (!d.asset) return `Holding that address: ${where}.\n\nWhich asset should I send?`;
    if (d.amount === null) return `**${d.asset}** to ${where}.\n\nHow much ${d.asset} should I send?`;
    return `**${d.asset}** to ${where}.`;
  }
  const who = `**${d.accountNumber}**${d.bankName ? ` at **${d.bankName}**` : ""}${
    d.resolvedName ? ` (${d.resolvedName})` : ""
  }`;
  if (!d.bankName) return `Got it — **${d.accountNumber}**.\n\nWhich bank is it?`;
  if (d.amount === null) return `Got it — ${who}.\n\nHow much should I send?`;
  return `Got it — ${who}.`;
}

async function handleTransferIntent(chatId: number, userId: string, text: string): Promise<boolean> {
  // A wallet address anywhere in the message routes to the crypto path. Checked
  // before the naira parser, because a NUBAN can't look like a chain address but
  // a chain address contains digits a money parser would happily misread.
  const crypto = parseCryptoAddress(text);
  if (crypto) return handleCryptoAddress(chatId, userId, crypto.address, crypto.family, text);

  // A transfer we're part-way through — from a photo, or from a request that
  // gave one piece at a time. Whatever this message adds gets filled in, in
  // whatever order it arrives: an account, then a bank, then an amount, or any
  // other way round. Every question Ada asks has to be answerable with just
  // the answer.
  const pending = await liveDraft(chatId);
  if (pending && draftGap({ ...pending, amount: pending.amount === null ? null : Number(pending.amount) })) {
    const add = fillFromReply(
      { ...pending, amount: pending.amount === null ? null : Number(pending.amount) },
      text,
      NIGERIAN_BANKS.map((b) => b.name),
    );
    let d = pending;
    // Which chain, when the address didn't say and neither did the first
    // message. "Arbitrum" on its own is a complete answer here.
    let addedNetwork = false;
    if (pending.kind === "crypto" && !pending.network) {
      const chain = parseEvmChain(text);
      if (chain) {
        d = await setDraftNetwork(chatId, chain);
        addedNetwork = true;
      }
    }
    // Which asset, on a chain where they hold more than one. The address is
    // already held, so this is the only piece the answer has to carry.
    let addedAsset = false;
    if (pending.kind === "crypto" && !pending.asset && pending.address) {
      const family = classify(pending.address)?.family;
      const held = family
        ? (
            await prisma.balance.findMany({
              where: { userId, kind: "crypto", symbol: { in: FAMILY_ASSETS[family] } },
              select: { symbol: true, amount: true },
            })
          )
            .filter((b) => Number(b.amount) > 0)
            .map((b) => b.symbol)
        : undefined;
      const asset = parseCryptoAsset(text, held);
      if (asset) {
        d = await setDraftAsset(chatId, asset);
        addedAsset = true;
      }
    }
    if (add.bank) d = (await setDraftBank(chatId, add.bank)) ?? d;
    if (add.amount) d = await setDraftAmount(chatId, add.amount);

    if (addedNetwork || addedAsset || add.bank || add.amount) {
      const state = { ...d, amount: d.amount === null ? null : Number(d.amount) };
      await say(chatId, draftGap(state) ? missingPiece(d) : draftPrompt(d));
      return true;
    }
  }

  // "Send money to this account number 9136214038, Moniepoint" — a request that
  // names WHO but not HOW MUCH. parseTransferIntent refuses it for lack of an
  // amount, so nothing was remembered and the follow-up had nothing to attach
  // to: Ada asked how much, was told, and then asked who all over again.
  const parts = transferParts(text);
  if (parts && parts.amount === null && parts.account) {
    // The bank may be missing, and that is fine — the account is held either
    // way. Asking "which bank?" while remembering nothing is what left the
    // answer with nothing to attach to.
    const bank = parseBankName(text, NIGERIAN_BANKS.map((b) => b.name)) ?? null;
    await createDraft({ userId, chatId, fiat: "NGN", accountNumber: parts.account, bankName: bank });
    const d = await liveDraft(chatId);
    if (d) await say(chatId, missingPiece(d));
    return true;
  }

  // "Go ahead" — with nothing pending, but a conversation that already settled
  // every detail. Ada could see all three pieces in the history and say so, and
  // still not be able to put a confirmation in front of anyone, because only
  // this code can create one and it was only ever shown the newest message.
  if (!pending && wantsToProceed(text)) {
    const from = assembleFromHistory(
      await recentTurns(chatId),
      NIGERIAN_BANKS.map((b) => b.name),
      (t) => parseAccountNumber(t) ?? undefined,
    );
    if (from.account) {
      await createDraft({
        userId,
        chatId,
        amount: from.amount ?? null,
        fiat: "NGN",
        accountNumber: from.account,
        bankName: from.bank ?? null,
      });
      const d = await liveDraft(chatId);
      if (d) {
        const state = { ...d, amount: d.amount === null ? null : Number(d.amount) };
        await say(chatId, draftGap(state) ? missingPiece(d) : draftPrompt(d));
        return true;
      }
    }
  }

  const intent = parseTransferIntent(text);
  if (!intent || !intent.amount) return false;

  // "Send the 0.05 Solana to the address I pasted" is not a naira transfer.
  //
  // Without this it became one: no account number in the message, so the bank
  // path took it, listed the user's bank beneficiaries and offered to send
  // ₦0.05. An asset named with no wallet address to send it to is a question
  // about the address, never an invitation to pay a bank account.
  if (!intent.account && mentionsCrypto(text)) {
    const asset = parseCryptoAsset(text);
    await say(
      chatId,
      `That's ${intent.amount} **${asset}** — to send it I need the wallet address.\n\n` +
        `Paste it here, or send a photo of the QR code, and I'll show you the address in full before anything moves.`,
    );
    return true;
  }

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
      if (draft) await say(chatId, draftPrompt(draft));
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
    await say(
      chatId,
      `I can send that — which account?${listed} Or paste it like *"send ₦${intent.amount.toLocaleString(
        "en-US",
      )} to 9077984753 Opay"* and I'll check the name before anything moves.`,
    );
    return true;
  }

  // The bank can be missing here too — "send 1,500 to 9136214038" is a
  // perfectly normal thing to say. Hold the amount and the account, ask the
  // one question, and the next word finishes it.
  const bankName = parseBankName(text, NIGERIAN_BANKS.map((b) => b.name)) ?? null;
  await createDraft({ userId, chatId, amount: intent.amount, fiat, accountNumber: intent.account, bankName });

  const draft = await liveDraft(chatId);
  if (draft) await say(chatId, bankName ? draftPrompt(draft) : missingPiece(draft));
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
    await say(chatId, res.message + notWiped);
    await sendReceipt(chatId, draft);
    return;
  }

  if (res.wrongPin) {
    const attempts = await bumpAttempts(chatId).catch(() => MAX_PIN_ATTEMPTS);
    if (attempts >= MAX_PIN_ATTEMPTS) {
      await clearDraft(chatId);
      await say(
        chatId,
        `That PIN was wrong too many times, so I've cancelled the transfer. Nothing was sent. Start again when you're ready.` + notWiped,
      );
      return;
    }
    await say(
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
  await say(chatId, res.message + notWiped);
}

/**
 * A picture of what just happened.
 *
 * Somebody who has just paid a market seller needs to SHOW them it went — and
 * a line of chat text isn't that. This is a real image they can forward.
 *
 * Best-effort by design: the money has already moved, so a receipt that fails
 * to render must never turn a completed transfer into an error. It is sent
 * AFTER the confirmation, never instead of it.
 */
async function sendReceipt(
  chatId: number,
  draft: NonNullable<Awaited<ReturnType<typeof liveDraft>>>,
): Promise<void> {
  try {
    const amount = Number(draft.amount);
    if (!(amount > 0)) return;
    const money = (n: number) =>
      `${draft.fiat === "NGN" ? "₦" : draft.fiat + " "}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const fee = transferFee(amount, draft.fiat);

    const crypto = draft.kind === "crypto";
    const when = new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

    const png = await renderReceiptPng({
      amount: crypto ? `${amount} ${draft.asset}` : money(amount),
      kind: crypto ? `${draft.network} transfer` : "Bank transfer",
      // A chain confirms in its own time, so claiming "completed" the instant
      // we hand it over would be a promise we can't keep.
      status: crypto ? "Sent" : "Completed",
      reference: `TG-${draft.id.slice(-10).toUpperCase()}`,
      rows: crypto
        ? [
            { label: "Asset", value: `${amount} ${draft.asset ?? ""}`.trim() },
            { label: "Network", value: draft.network ?? "" },
            { label: "To", value: draft.address ?? "" },
            { label: "Date", value: when },
          ]
        : [
            { label: "To", value: draft.accountName ?? "" },
            { label: "Account", value: draft.accountNumber ?? "" },
            { label: "Bank", value: draft.bankName ?? "" },
            { label: "Amount", value: money(amount) },
            ...(fee !== null ? [{ label: "Fee", value: money(fee) }] : []),
            { label: "Date", value: when },
          ],
    });
    if (png) await sendPhoto(chatId, png, "Receipt — forward this to whoever you paid.");
  } catch (e) {
    console.error("[telegram] receipt failed", e);
  }
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
    // Only when the draft is actually awaiting a PIN. A draft still waiting to
    // be told the amount — or which bank — would otherwise swallow "1200" as a
    // PIN, deleting the message and failing with a wrong-PIN error.
    if (
      draft &&
      draft.amount !== null &&
      (draft.kind === "crypto" ? !!draft.asset : !!draft.bankName)
    ) {
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
      // The chat is no longer that account's, so what was said about it stops
      // being ours to remember.
      await forgetChat(chatId);
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

    // Written down before anything answers it, so the reply — whether it comes
    // from the parser or the model — has the question in front of it next time.
    // After the command handlers, so a /start token never lands in the history.
    await rememberTurn(chatId, "user", text);

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

    // What's actually pending goes to the model too. Without it she answered
    // from the conversation alone and described transfers that didn't exist.
    const stillPending = linked ? await liveDraft(chatId) : null;
    await say(
      chatId,
      await reply(chatId, text.replace(/^\/\w+\s*/, ""), linked?.id ?? null, ctx, stillPending),
    );
  } catch (e) {
    console.error("[telegram] reply failed", e);
    await sendMessage(chatId, "Something went wrong on my side — try again in a moment.");
  }

  return NextResponse.json({ ok: true });
}
