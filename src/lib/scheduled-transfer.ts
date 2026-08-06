import "server-only";
import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { signSessionToken, SESSION_COOKIE } from "./auth";
import { baseUrl } from "./url";
import { MAX_SCHEDULE_DAYS } from "./assistant/when";

/**
 * Transfers the user asked for later.
 *
 * The PIN is verified when the transfer is SCHEDULED and never stored. That is
 * the same bargain a standing order makes at a bank: you authorise it once, in
 * person, and it runs without you. Asking for the PIN at run time would need
 * the user present, which is the one thing scheduling exists to avoid — and
 * storing a PIN to replay later would be indefensible whatever it bought us.
 *
 * What stands in for the PIN at run time is a signed, single-use authorisation
 * derived from AUTH_SECRET and the row's own id. It is minted only by this
 * process, only for a row that is due, and the row moves to "sending" before it
 * is used — so it cannot be replayed, and a stolen one is worthless because it
 * names a row that has already moved on.
 *
 * Everything else — KYC, limits, the funding plan across wallets, idempotency —
 * happens in /api/send exactly as it does for an immediate transfer. There is
 * no second copy of the payout path here, and there must never be.
 */

/** Live states, in order. */
export const SCHEDULE_ACTIVE = ["scheduled", "sending"];

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error("AUTH_SECRET is not set.");
  return s;
}

/** The run-time authorisation for one scheduled row. Never leaves the server. */
export function scheduleAuth(id: string, userId: string): string {
  return crypto.createHmac("sha256", secret()).update(`schedule:${id}:${userId}`).digest("hex");
}

/**
 * Verify an authorisation and consume the row it names.
 *
 * Consuming is the point: the row must be in "sending" — which only the runner
 * does, and only once — so the same authorisation cannot pay twice.
 */
export async function consumeScheduleAuth(userId: string, token: string): Promise<boolean> {
  const id = token.split(":")[0];
  const mac = token.slice(id.length + 1);
  if (!id || !mac) return false;

  const row = await prisma.scheduledTransfer.findUnique({ where: { id } });
  if (!row || row.userId !== userId || row.status !== "sending") return false;

  const expected = scheduleAuth(row.id, row.userId);
  // Constant-time: a token check that leaks timing is a token check that can be
  // guessed a byte at a time.
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export interface ScheduleInput {
  userId: string;
  runAt: Date;
  said: string;
  fiat: string;
  symbol: string;
  amount: number;
  bankName: string;
  accountNumber: string;
  accountName?: string | null;
  note?: string | null;
  chatId?: string | null;
}

export async function scheduleBankTransfer(input: ScheduleInput) {
  return prisma.scheduledTransfer.create({
    data: {
      userId: input.userId,
      kind: "bank",
      status: "scheduled",
      runAt: input.runAt,
      said: input.said,
      fiat: input.fiat,
      symbol: input.symbol,
      amount: new Prisma.Decimal(input.amount),
      bankName: input.bankName,
      accountNumber: input.accountNumber,
      accountName: input.accountName ?? null,
      note: input.note ?? null,
      chatId: input.chatId ?? null,
    },
  });
}

/** Everything still waiting for this user, soonest first. */
export async function upcomingTransfers(userId: string) {
  return prisma.scheduledTransfer.findMany({
    where: { userId, status: { in: SCHEDULE_ACTIVE } },
    orderBy: { runAt: "asc" },
    take: 25,
  });
}

/**
 * Cancel one, if it hasn't started.
 *
 * A scheduled payment nobody can stop is a worse product than no scheduling at
 * all, so this exists before anything else does. Once a row is "sending" the
 * money may already be with the provider and cancelling would be a lie.
 */
export async function cancelScheduled(userId: string, id: string): Promise<boolean> {
  const res = await prisma.scheduledTransfer.updateMany({
    where: { id, userId, status: "scheduled" },
    data: { status: "cancelled" },
  });
  return res.count > 0;
}

export interface RunOutcome {
  id: string;
  ok: boolean;
  chatId: string | null;
  /** What to tell the user. */
  message: string;
  amount: number;
  fiat: string;
  accountName: string | null;
}

/**
 * Send everything that is due.
 *
 * Claims each row with a conditional update before doing anything, so two
 * overlapping cron runs cannot both pay the same transfer. The idempotency key
 * is derived from the row id as a second line of defence — /api/send's unique
 * settlement reference then refuses a duplicate outright.
 */
export async function runDueTransfers(limit = 25): Promise<RunOutcome[]> {
  const due = await prisma.scheduledTransfer.findMany({
    where: { status: "scheduled", runAt: { lte: new Date() } },
    orderBy: { runAt: "asc" },
    take: limit,
  });

  const out: RunOutcome[] = [];
  for (const row of due) {
    // Claim it. If another runner got there first, count is 0 and we skip.
    const claimed = await prisma.scheduledTransfer.updateMany({
      where: { id: row.id, status: "scheduled" },
      data: { status: "sending", attempts: { increment: 1 } },
    });
    if (claimed.count === 0) continue;

    const result = await dispatch(row);
    await prisma.scheduledTransfer.update({
      where: { id: row.id },
      data: {
        status: result.ok ? "sent" : "failed",
        error: result.ok ? null : result.message.slice(0, 400),
        reference: result.ok ? `sch-${row.id}` : null,
        sentAt: result.ok ? new Date() : null,
      },
    });
    out.push({
      id: row.id,
      ok: result.ok,
      chatId: row.chatId,
      message: result.message,
      amount: Number(row.amount),
      fiat: row.fiat,
      accountName: row.accountName,
    });
  }
  return out;
}

/**
 * Put it through /api/send as the user, exactly as the app or the bot would.
 *
 * The same reasoning as the Telegram sender: one payout path, with every check
 * inside it, rather than a second copy here that drifts out of step.
 */
async function dispatch(row: {
  id: string;
  userId: string;
  fiat: string;
  symbol: string;
  amount: Prisma.Decimal;
  bankName: string | null;
  accountNumber: string | null;
  accountName: string | null;
  note: string | null;
}): Promise<{ ok: boolean; message: string }> {
  if (!row.bankName || !row.accountNumber) {
    return { ok: false, message: "The destination was incomplete, so nothing was sent." };
  }

  const base = baseUrl().replace(/\/$/, "");
  if (!base) {
    console.error("[scheduled] no base URL — cannot reach /api/send", row.id);
    return { ok: false, message: "Couldn't reach the app, so nothing was sent." };
  }

  const token = await signSessionToken(row.userId, "5m");
  let res: Response;
  try {
    res = await fetch(`${base}/api/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `${SESSION_COOKIE}=${token}` },
      body: JSON.stringify({
        mode: "bank",
        fiat: row.fiat,
        symbol: row.symbol,
        amount: Number(row.amount),
        bankName: row.bankName,
        accountNumber: row.accountNumber,
        accountName: row.accountName ?? undefined,
        note: row.note ?? undefined,
        scheduleAuth: `${row.id}:${scheduleAuth(row.id, row.userId)}`,
        idempotencyKey: `sch-${row.id}`,
      }),
    });
  } catch (e) {
    // Same rule as every other send: a throw is not a failure. It may have
    // reached the provider, so it must not be retried automatically.
    console.error("[scheduled] send threw", row.id, e);
    return { ok: false, message: "I lost the connection while sending it — check your history before resending." };
  }

  if (res.ok) return { ok: true, message: "sent" };
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: false, message: body.error ?? "That didn't go through." };
}

/** Human summary for a confirmation or a list. */
export function describeSchedule(row: { said: string | null; runAt: Date }): string {
  return row.said ?? row.runAt.toISOString().slice(0, 16).replace("T", " ");
}

export { MAX_SCHEDULE_DAYS };
