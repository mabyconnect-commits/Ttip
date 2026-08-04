import "server-only";
import { prisma } from "./db";
import { signSessionToken, SESSION_COOKIE } from "./auth";
import { baseUrl } from "./url";
import { resolveAccountName } from "./settlement";
import { transferFee } from "./pricing";

/**
 * Sending money from a Telegram chat.
 *
 * Two things make this defensible rather than reckless:
 *
 *  1. The PIN never rests in the chat. The moment the webhook reads it, the
 *     message is deleted from the conversation — the user doesn't have to
 *     remember to do it, and it isn't sitting in their history or on a lock
 *     screen. That deletion happens BEFORE the transfer is attempted, so it
 *     happens whether the transfer succeeds, fails or times out.
 *
 *  2. Not one line of the payout path is duplicated here. This mints a session
 *     for the LINKED user and calls our own /api/send, so the PIN check, the
 *     KYC tier limits, the rolling-24h cap, the multi-wallet funding plan, the
 *     idempotency key and the ambiguous-provider-response handling are all the
 *     exact code the app uses. A second implementation of "move money" is how
 *     you get two different answers to the same question.
 *
 * The draft is per-chat and single-use, so a PIN can only ever apply to the
 * transfer the user was just shown — never to a stale one still lying around.
 */

/** How long a pending transfer waits for its PIN. */
const DRAFT_TTL_MS = 5 * 60_000;
/** Wrong PINs before the draft is torn down. */
const MAX_ATTEMPTS = 3;

/**
 * A ceiling on chat-initiated transfers, on top of the user's KYC limits.
 *
 * ₦100,000 by default. A chat window is a softer target than the app — no
 * device binding, no app lock, and a phone someone has already unlocked — so
 * everyday amounts go through here and anything larger goes through the app.
 * Override with TELEGRAM_MAX_TRANSFER_NGN; set it to 0 to remove the extra cap
 * and let the KYC limits stand alone.
 */
const DEFAULT_MAX_TRANSFER_NGN = 100_000;

export function telegramMaxTransfer(): number | null {
  const raw = process.env.TELEGRAM_MAX_TRANSFER_NGN;
  if (raw !== undefined) {
    // Tolerate "100,000" — it's the way the number is actually written down.
    const v = Number(String(raw).replace(/[,_\s]/g, ""));
    if (Number.isFinite(v) && v >= 0) return v > 0 ? v : null;
  }
  return DEFAULT_MAX_TRANSFER_NGN;
}

export interface DraftInput {
  userId: string;
  chatId: number | string;
  amount: number;
  fiat: string;
  accountNumber: string;
  bankName: string;
}

/** Looks the account up at the bank, then stores it as the chat's live draft. */
export async function createDraft(input: DraftInput) {
  const resolved = await resolveAccountName(input.bankName, input.accountNumber, input.fiat).catch(() => null);
  const chatId = String(input.chatId);

  const data = {
    userId: input.userId,
    amount: input.amount,
    fiat: input.fiat,
    accountNumber: input.accountNumber,
    bankName: input.bankName,
    accountName: resolved ?? `${input.bankName} ${input.accountNumber}`,
    resolvedName: resolved,
    attempts: 0,
    expiresAt: new Date(Date.now() + DRAFT_TTL_MS),
  };

  // One live draft per chat: the newest request replaces anything older, so a
  // PIN can never land on a transfer the user has moved on from.
  await prisma.telegramDraft.upsert({
    where: { chatId },
    create: { chatId, ...data },
    update: data,
  });

  return { resolved };
}

export async function liveDraft(chatId: number | string) {
  const draft = await prisma.telegramDraft.findUnique({ where: { chatId: String(chatId) } });
  if (!draft) return null;
  if (draft.expiresAt.getTime() < Date.now()) {
    await clearDraft(chatId);
    return null;
  }
  return draft;
}

export async function clearDraft(chatId: number | string): Promise<void> {
  await prisma.telegramDraft.deleteMany({ where: { chatId: String(chatId) } });
}

/** The confirmation text shown before the PIN is asked for. */
export function draftPrompt(d: {
  amount: unknown;
  fiat: string;
  accountNumber: string;
  bankName: string;
  accountName: string;
  resolvedName: string | null;
}): string {
  const amount = Number(d.amount);
  const fee = transferFee(amount, d.fiat);
  const money = (n: number) => `${d.fiat === "NGN" ? "₦" : d.fiat + " "}${n.toLocaleString("en-US")}`;

  const who = d.resolvedName
    ? `**${d.resolvedName}**`
    : `**${d.accountNumber}** — *the bank couldn't confirm the name, so check the number*`;

  return (
    `**Sending ${money(amount)}**\n` +
    `To: ${who}\n` +
    `${d.accountNumber} · ${d.bankName}\n` +
    (fee !== null ? `Fee: ${money(fee)} (taken from your balance, they get the full ${money(amount)})\n` : "") +
    `\nReply with your **transaction PIN** to send it. I delete your PIN from this chat the second I read it.\n` +
    `Send /cancel to drop it.`
  );
}

export type SendOutcome =
  | { ok: true; message: string }
  | { ok: false; wrongPin: boolean; message: string };

/**
 * Executes the draft through the app's own /api/send.
 *
 * The session is minted for the linked user and lives for one request. Nothing
 * is bypassed: /api/send still verifies the PIN, the KYC status and the limits,
 * and still owns the idempotency key — this is the same call the app makes.
 */
export async function sendDraft(
  draft: {
    id: string;
    userId: string;
    amount: unknown;
    fiat: string;
    accountNumber: string;
    bankName: string;
    accountName: string;
  },
  pin: string,
): Promise<SendOutcome> {
  const amount = Number(draft.amount);
  const money = (n: number) => `${draft.fiat === "NGN" ? "₦" : draft.fiat + " "}${n.toLocaleString("en-US")}`;

  const cap = telegramMaxTransfer();
  if (cap !== null && draft.fiat === "NGN" && amount > cap) {
    return {
      ok: false,
      wrongPin: false,
      message: `Transfers from Telegram are capped at ${money(cap)}. Send ${money(amount)} from the app instead.`,
    };
  }

  // No base URL means the request was never built, let alone dispatched — the
  // money definitively did not move. That has to read differently from a
  // request that WAS sent and then timed out: telling someone "I don't know if
  // it went through" about a transfer that provably didn't makes them afraid to
  // retry something they should just retry.
  const base = baseUrl().replace(/\/$/, "");
  if (!base) {
    console.error("[telegram] no base URL — cannot reach /api/send");
    return {
      ok: false,
      wrongPin: false,
      message: "I couldn't reach the app to complete that, so **nothing was sent**. Please try again in a moment.",
    };
  }

  const token = await signSessionToken(draft.userId, "5m");

  let res: Response;
  try {
    res = await fetch(`${base}/api/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${SESSION_COOKIE}=${token}`,
      },
      body: JSON.stringify({
        mode: "bank",
        fiat: draft.fiat,
        symbol: draft.fiat,
        amount,
        bankName: draft.bankName,
        accountNumber: draft.accountNumber,
        accountName: draft.accountName,
        note: "Sent from Telegram",
        pin,
        // Derived from the draft id, so a retried webhook delivery — Telegram
        // retries anything that isn't a 200 — cannot send the money twice.
        idempotencyKey: `tg-${draft.id}`,
      }),
    });
  } catch (e) {
    // A throw is NOT a failure: the request may have reached the payout
    // provider. Never tell the user it failed, or they will send it again.
    console.error("[telegram] send request threw", e);
    return {
      ok: false,
      wrongPin: false,
      message:
        `I lost the connection while sending that, so I can't tell you yet whether it went through. ` +
        `**Don't send it again** — open ${baseUrl().replace(/^https?:\/\//, "")} and check your transactions first.`,
    };
  }

  if (res.ok) {
    return { ok: true, message: `Sent ✅ ${money(amount)} to ${draft.accountName}.` };
  }

  const body = (await res.json().catch(() => ({}))) as { error?: string };
  const wrongPin = res.status === 401 || res.status === 428;
  return {
    ok: false,
    wrongPin,
    message: body.error ?? "That didn't go through. Try again from the app.",
  };
}

export async function bumpAttempts(chatId: number | string): Promise<number> {
  const d = await prisma.telegramDraft.update({
    where: { chatId: String(chatId) },
    data: { attempts: { increment: 1 } },
  });
  return d.attempts;
}

export const MAX_PIN_ATTEMPTS = MAX_ATTEMPTS;
