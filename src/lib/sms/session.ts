import "server-only";
import crypto from "crypto";
import { prisma } from "../db";
import { signSessionToken, SESSION_COOKIE } from "../auth";
import { baseUrl } from "../url";
import { smsConfirmWindowMs } from "./limits";

/**
 * Proof that a single-use code was spent for this exact transfer.
 *
 * The PIN never travels by SMS, so something has to stand in for it at
 * /api/send. This is minted only inside this process, only after a code was
 * consumed, and only for one draft id — which is itself single-use, because the
 * draft is deleted the moment the transfer goes.
 */
export function smsAuth(draftId: string, userId: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) throw new Error("AUTH_SECRET is not set.");
  return crypto.createHmac("sha256", secret).update(`sms:${draftId}:${userId}`).digest("hex");
}

/** Verify one. Constant-time, and the draft it names must still exist. */
export async function verifySmsAuth(userId: string, token: string): Promise<boolean> {
  const draftId = token.split(":")[0];
  const mac = token.slice(draftId.length + 1);
  if (!draftId || !mac) return false;

  const draft = await prisma.telegramDraft.findUnique({ where: { id: draftId } });
  if (!draft || draft.userId !== userId || !draft.chatId.startsWith("sms:")) return false;

  const a = Buffer.from(mac);
  const b = Buffer.from(smsAuth(draftId, userId));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * The transfer a text message set up, waiting for its code.
 *
 * Reuses TelegramDraft rather than adding a second table: it is already "the
 * one transfer this conversation is about", already expires, already counts
 * failed attempts, and already dies when a newer request replaces it. The chat
 * key is namespaced so an SMS conversation and a Telegram one can never collide
 * — and so a code texted in can only ever apply to the transfer that was texted
 * about.
 */

const KEY = (phone: string) => `sms:${phone}`;

export async function pendingSms(phone: string) {
  const draft = await prisma.telegramDraft.findUnique({ where: { chatId: KEY(phone) } });
  if (!draft) return null;
  if (draft.expiresAt.getTime() < Date.now()) {
    await prisma.telegramDraft.deleteMany({ where: { chatId: KEY(phone) } });
    return null;
  }
  return draft;
}

export async function clearSms(phone: string): Promise<void> {
  await prisma.telegramDraft.deleteMany({ where: { chatId: KEY(phone) } });
}

export async function startSmsTransfer(input: {
  userId: string;
  phone: string;
  amount: number;
  fiat: string;
  accountNumber: string;
  bankName: string;
  accountName: string;
}) {
  const data = {
    userId: input.userId,
    kind: "bank",
    amount: input.amount,
    fiat: input.fiat,
    accountNumber: input.accountNumber,
    bankName: input.bankName,
    accountName: input.accountName,
    resolvedName: input.accountName,
    asset: null,
    network: null,
    address: null,
    scheduleAt: null,
    scheduleSaid: null,
    attempts: 0,
    expiresAt: new Date(Date.now() + smsConfirmWindowMs()),
  };
  const chatId = KEY(input.phone);
  return prisma.telegramDraft.upsert({ where: { chatId }, create: { chatId, ...data }, update: data });
}

/**
 * What has already left by SMS in the last 24 hours.
 *
 * Counted from the transactions themselves rather than a running total, so a
 * refunded or failed transfer stops counting against the cap the moment it
 * fails — a user should not lose today's allowance to a transfer that never
 * happened.
 */
export async function sentBySmsToday(userId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 3600_000);
  const rows = await prisma.transaction.findMany({
    where: {
      userId,
      type: "withdraw_bank",
      status: { in: ["pending", "completed"] },
      createdAt: { gte: since },
      meta: { path: ["surface"], equals: "sms" },
    },
    select: { amountOut: true },
  });
  return rows.reduce((sum, r) => sum + Number(r.amountOut ?? 0), 0);
}

export interface SmsSendOutcome {
  ok: boolean;
  message: string;
}

/**
 * Put the transfer through /api/send, as the user.
 *
 * Same reasoning as the Telegram sender and the scheduled runner: one payout
 * path, with the KYC checks, the limits, the multi-wallet funding plan and the
 * idempotency key all inside it. `scheduleAuth` is not used here — SMS carries
 * its own authorisation, already spent by the caller before this is reached.
 */
export async function sendSmsTransfer(
  draft: { id: string; userId: string; amount: unknown; fiat: string; accountNumber: string | null; bankName: string | null; accountName: string | null },
): Promise<SmsSendOutcome> {
  const amount = Number(draft.amount);
  const money = (n: number) => `${draft.fiat === "NGN" ? "₦" : draft.fiat + " "}${n.toLocaleString("en-US")}`;

  const base = baseUrl().replace(/\/$/, "");
  if (!base) {
    console.error("[sms] no base URL — cannot reach /api/send");
    return { ok: false, message: "Couldn't complete that. Nothing was sent. Try again shortly." };
  }

  const token = await signSessionToken(draft.userId, "5m");
  let res: Response;
  try {
    res = await fetch(`${base}/api/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `${SESSION_COOKIE}=${token}` },
      body: JSON.stringify({
        mode: "bank",
        fiat: draft.fiat,
        symbol: draft.fiat,
        amount,
        bankName: draft.bankName,
        accountNumber: draft.accountNumber,
        accountName: draft.accountName,
        note: "Sent by SMS",
        // Not the PIN. The single-use code the user texted has already been
        // spent by the caller, and this is the server saying so — an HMAC over
        // this draft's own id, which /api/send checks and which nothing outside
        // this process can mint.
        smsAuth: `${draft.id}:${smsAuth(draft.id, draft.userId)}`,
        surface: "sms",
        idempotencyKey: `sms-${draft.id}`,
      }),
    });
  } catch (e) {
    // A throw is not a failure — it may have reached the provider. Never tell
    // someone it failed, or they text it again.
    console.error("[sms] send threw", e);
    return {
      ok: false,
      message: "I lost the connection sending that. DON'T send again — check the app before retrying.",
    };
  }

  if (res.ok) return { ok: true, message: `Sent ${money(amount)} to ${draft.accountName}.` };
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: false, message: (body.error ?? "That didn't go through.").slice(0, 140) };
}
