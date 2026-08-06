import "server-only";
import { prisma } from "./db";
import { signSessionToken, SESSION_COOKIE } from "./auth";
import { baseUrl } from "./url";
import { resolveAccountName } from "./settlement";
import { transferFee } from "./pricing";
import { requireWithdrawPin } from "./withdraw-pin";
import { scheduleBankTransfer } from "./scheduled-transfer";
import { scheduleProblem } from "./assistant/when";

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

/** How long a READY transfer waits for its PIN. */
const DRAFT_TTL_MS = 5 * 60_000;
/**
 * How long a half-built one is held.
 *
 * Longer, and safely so: an incomplete draft cannot be sent — sendDraft refuses
 * it and the webhook won't read a PIN against it — so the only thing this
 * changes is whether the user is still remembered when they come back. Five
 * minutes is the right window for "type your PIN"; it is far too short for a
 * conversation held in voice notes, where expiring meant forgetting the address
 * again and asking for everything from the top.
 */
const PARTIAL_TTL_MS = 30 * 60_000;

/** A draft that still needs something can be held for longer, because it can't move money. */
function expiryFor(complete: boolean): Date {
  return new Date(Date.now() + (complete ? DRAFT_TTL_MS : PARTIAL_TTL_MS));
}
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
  /** Omitted when we know WHO but not yet HOW MUCH. */
  amount?: number | null;
  fiat: string;
  accountNumber: string;
  /** Null while we know the account but not yet the bank. */
  bankName: string | null;
  /**
   * When the user asked for it to go, if they said. "in 30min from now" was
   * being read for its digits and thrown away for its meaning — the transfer
   * went immediately. A draft that carries a time is confirmed INTO a schedule,
   * never into an immediate send.
   */
  scheduleAt?: Date | null;
  scheduleSaid?: string | null;
}

/** A crypto send: an address on a network, and an asset to send. */
export interface CryptoDraftInput {
  userId: string;
  chatId: number | string;
  amount?: number | null;
  /** Null while we know the address but not yet which asset to send on it. */
  asset: string | null;
  /**
   * Null while we know the address but not yet WHICH CHAIN. One 0x address is
   * valid on Ethereum, Arbitrum, Base, Polygon and every other EVM rail, and
   * they hold different money — so unless the user named one, this is a
   * question, not a default.
   */
  network: string | null;
  address: string;
}

/**
 * Store a pending crypto send.
 *
 * No name lookup — a chain has nobody to ask who owns an address. That absence
 * is the whole reason the confirmation shows the address in full and says so
 * out loud: on a bank transfer the bank vouches for the destination, and here
 * nothing does.
 */
export async function createCryptoDraft(input: CryptoDraftInput) {
  const chatId = String(input.chatId);
  const data = {
    userId: input.userId,
    kind: "crypto",
    amount: input.amount ?? null,
    // `fiat` is the unit the amount is counted in — the asset, for a chain.
    fiat: input.asset ?? input.network ?? "crypto",
    asset: input.asset,
    network: input.network,
    address: input.address,
    accountNumber: null,
    bankName: null,
    accountName: null,
    resolvedName: null,
    // Crypto sends don't schedule: promising a time on a rail we don't control
    // is a promise we can't keep.
    scheduleAt: null,
    scheduleSaid: null,
    attempts: 0,
    expiresAt: expiryFor(!!input.asset && !!input.network && input.amount != null),
  };
  await prisma.telegramDraft.upsert({ where: { chatId }, create: { chatId, ...data }, update: data });
}

/**
 * Looks the account up at the bank, then stores it as the chat's live draft.
 *
 * The bank may be missing: someone reads out an account number and names the
 * bank in the next breath. Holding what we have and asking for the rest is the
 * only way that conversation can work — asking a question and remembering
 * nothing is what made Ada seem to forget the number she had just repeated.
 */
export async function createDraft(input: DraftInput) {
  const resolved = input.bankName
    ? await resolveAccountName(input.bankName, input.accountNumber, input.fiat).catch(() => null)
    : null;
  const chatId = String(input.chatId);

  const data = {
    userId: input.userId,
    kind: "bank",
    asset: null,
    network: null,
    address: null,
    amount: input.amount ?? null,
    fiat: input.fiat,
    accountNumber: input.accountNumber,
    bankName: input.bankName,
    accountName: resolved ?? `${input.bankName ?? ""} ${input.accountNumber}`.trim(),
    resolvedName: resolved,
    scheduleAt: input.scheduleAt ?? null,
    scheduleSaid: input.scheduleSaid ?? null,
    attempts: 0,
    expiresAt: expiryFor(!!input.bankName && input.amount != null),
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

/**
 * Fill in the amount on a draft that was only missing that.
 *
 * The photo told us who; this message tells us how much. Asking the user to
 * repeat an account number they've already shown us is exactly the retyping
 * the camera was meant to remove.
 */
export async function setDraftAmount(chatId: number | string, amount: number) {
  const id = String(chatId);
  const draft = await prisma.telegramDraft.findUnique({ where: { chatId: id } });
  const complete = draft?.kind === "crypto" ? !!draft.asset && !!draft.network : !!draft?.bankName;
  return prisma.telegramDraft.update({
    where: { chatId: id },
    data: { amount, attempts: 0, expiresAt: expiryFor(complete) },
  });
}

/**
 * Fill in the chain on a crypto draft that was only missing that.
 *
 * "Send 9.34 USDT to this Arbitrum wallet 0x83c0…" used to be confirmed as
 * "Network: Ethereum", because one 0x address was read as one chain. The chain
 * the user names now sticks; when they name none, this is what their answer to
 * "which network?" lands in.
 */
export async function setDraftNetwork(chatId: number | string, network: string) {
  const id = String(chatId);
  const draft = await prisma.telegramDraft.findUnique({ where: { chatId: id } });
  return prisma.telegramDraft.update({
    where: { chatId: id },
    data: { network, attempts: 0, expiresAt: expiryFor(!!draft?.asset && draft?.amount != null) },
  });
}

/**
 * Fill in the asset on a crypto draft that was only missing that.
 *
 * A QR gives you an address, not what to send on it — and on a chain where the
 * user holds several assets, "which one?" is a real question. It used to be
 * asked with nothing remembered, so the answer arrived with no address to
 * attach to and a spoken "0.05 Solana" fell through to the naira parser.
 */
export async function setDraftAsset(chatId: number | string, asset: string) {
  const id = String(chatId);
  const draft = await prisma.telegramDraft.findUnique({ where: { chatId: id } });
  return prisma.telegramDraft.update({
    where: { chatId: id },
    data: {
      asset,
      fiat: asset,
      attempts: 0,
      expiresAt: expiryFor(!!draft?.network && draft?.amount != null),
    },
  });
}

/**
 * Attach a time to a draft that was already half-built.
 *
 * "Send 2k to 8113866493 Opay" and then, a message later, "actually make it
 * 6pm". The account and the amount are already held; the time is the only thing
 * this message adds, and it must not require repeating the rest.
 */
export async function setDraftSchedule(chatId: number | string, at: Date, said: string) {
  return prisma.telegramDraft.update({
    where: { chatId: String(chatId) },
    data: { scheduleAt: at, scheduleSaid: said, attempts: 0 },
  });
}

/**
 * Fill in the bank on a draft that was only missing that.
 *
 * The name lookup happens here rather than at creation, because until there is
 * a bank there is nobody to ask who owns the number.
 */
export async function setDraftBank(chatId: number | string, bankName: string) {
  const id = String(chatId);
  const draft = await prisma.telegramDraft.findUnique({ where: { chatId: id } });
  if (!draft?.accountNumber) return draft;

  const resolved = await resolveAccountName(bankName, draft.accountNumber, draft.fiat).catch(() => null);
  return prisma.telegramDraft.update({
    where: { chatId: id },
    data: {
      bankName,
      resolvedName: resolved,
      accountName: resolved ?? `${bankName} ${draft.accountNumber}`,
      attempts: 0,
      expiresAt: expiryFor(draft.amount != null),
    },
  });
}

/** The confirmation text shown before the PIN is asked for. */
export function draftPrompt(d: {
  kind?: string;
  amount: unknown;
  fiat: string;
  accountNumber: string | null;
  bankName: string | null;
  accountName: string | null;
  resolvedName: string | null;
  asset?: string | null;
  network?: string | null;
  address?: string | null;
  scheduleAt?: Date | null;
  scheduleSaid?: string | null;
}): string {
  if (d.kind === "crypto") return cryptoPrompt(d);
  const amount = Number(d.amount);
  const fee = transferFee(amount, d.fiat);
  const money = (n: number) => `${d.fiat === "NGN" ? "₦" : d.fiat + " "}${n.toLocaleString("en-US")}`;

  const who = d.resolvedName
    ? `**${d.resolvedName}**`
    : `**${d.accountNumber}** — *the bank couldn't confirm the name, so check the number*`;

  // A scheduled transfer has to LOOK different from an immediate one, at the
  // moment the PIN is asked for. Someone who wrote "in 30 minutes" and is shown
  // "Sending ₦2,000" has been told their instruction was heard when it wasn't.
  const later = !!d.scheduleAt;

  return (
    `**${later ? "Scheduling" : "Sending"} ${money(amount)}**\n` +
    `To: ${who}\n` +
    `${d.accountNumber} · ${d.bankName}\n` +
    (later ? `Goes out: **${d.scheduleSaid ?? "later"}**\n` : "") +
    (fee !== null ? `Fee: ${money(fee)} (taken from your balance, they get the full ${money(amount)})\n` : "") +
    (later
      ? `\nNothing leaves your balance until then, and it needs to be there when the time comes.\n` +
        `Reply with your **transaction PIN** to set it up. I delete your PIN from this chat the second I read it.\n` +
        `Send /cancel to drop it, or /scheduled later to see or cancel it.`
      : `\nReply with your **transaction PIN** to send it. I delete your PIN from this chat the second I read it.\n` +
        `Send /cancel to drop it.`)
  );
}

/**
 * The crypto confirmation.
 *
 * The full address, never shortened. On a bank transfer the bank tells us whose
 * account it is and the user checks a name; on a chain there is no such answer,
 * so the only thing they can check is the string itself — and they cannot check
 * what we have hidden behind an ellipsis.
 */
function cryptoPrompt(d: {
  amount: unknown;
  asset?: string | null;
  network?: string | null;
  address?: string | null;
}): string {
  const amount = Number(d.amount);
  return (
    `**Sending ${amount} ${d.asset}**\n` +
    `Network: **${d.network}**\n` +
    `To:\n\`${d.address}\`\n\n` +
    `⚠️ Check every character. A crypto transfer cannot be reversed, and nobody ` +
    `can tell me who owns this address.\n\n` +
    `Reply with your **transaction PIN** to send it. I delete your PIN from this chat the second I read it.\n` +
    `Send /cancel to drop it.`
  );
}

export type SendOutcome =
  /**
   * `pending` is the difference between "your money is there" and "we've asked
   * the chain". A live crypto withdrawal is QUEUED — the treasury signs it, the
   * provider delivers it, and only then does it complete. /api/send returns 200
   * either way, and reading only that status code is how a queued send was
   * announced as "Sent ✅" while the app's own history said Pending. The two
   * screens were describing the same transfer and the user was right not to
   * believe either.
   */
  | { ok: true; pending?: boolean; message: string }
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
    kind?: string;
    amount: unknown;
    fiat: string;
    accountNumber: string | null;
    bankName: string | null;
    accountName: string | null;
    asset?: string | null;
    network?: string | null;
    address?: string | null;
  },
  pin: string,
): Promise<SendOutcome> {
  const amount = Number(draft.amount);
  const money = (n: number) => `${draft.fiat === "NGN" ? "₦" : draft.fiat + " "}${n.toLocaleString("en-US")}`;

  // Same for a crypto draft that knows the address but not what to send on it.
  if (draft.kind === "crypto" && !draft.asset) {
    return {
      ok: false,
      wrongPin: false,
      message: `I still don't know which asset to send to that address — tell me which and I'll set it up.`,
    };
  }

  // And the chain. An 0x address alone doesn't say whether the money should
  // land on Ethereum, Arbitrum, Base or BNB Chain, and sending on the wrong one
  // can put it somewhere the recipient will never see it.
  if (draft.kind === "crypto" && !draft.network) {
    return {
      ok: false,
      wrongPin: false,
      message: `I still don't know which network to send that on — tell me the chain and I'll set it up.`,
    };
  }

  // A bank draft can now exist before its bank is known — the account arrives
  // in one breath and the bank in the next. Half a destination must never
  // reach the payout path, whatever asked it to.
  if (draft.kind !== "crypto" && !draft.bankName) {
    return {
      ok: false,
      wrongPin: false,
      message: `I still don't know which bank ${draft.accountNumber ?? "that account"} is with — tell me the bank and I'll set it up.`,
    };
  }

  const cap = telegramMaxTransfer();
  // The cap is a naira ceiling; a crypto amount is not naira, so it is governed
  // by the app's own crypto withdrawal limit rather than this one.
  if (draft.kind !== "crypto" && cap !== null && draft.fiat === "NGN" && amount > cap) {
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
      body: JSON.stringify(
        draft.kind === "crypto"
          ? {
              mode: "wallet",
              symbol: draft.asset,
              amount,
              address: draft.address,
              network: draft.network,
              pin,
              idempotencyKey: `tg-${draft.id}`,
            }
          : {
              mode: "bank",
              fiat: draft.fiat,
              symbol: draft.fiat,
              amount,
              bankName: draft.bankName,
              accountNumber: draft.accountNumber,
              accountName: draft.accountName,
              note: "Sent from Telegram",
              pin,
              // Derived from the draft id, so a retried webhook delivery —
              // Telegram retries anything that isn't a 200 — cannot send the
              // money twice.
              idempotencyKey: `tg-${draft.id}`,
            },
      ),
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
    const receipt = ((await res.json().catch(() => ({}))) as { receipt?: { status?: string } }).receipt;
    // Only "completed" has actually left. Anything else is queued, and saying
    // otherwise is a claim about someone's money that we cannot support.
    const pending = draft.kind === "crypto" && receipt?.status !== "completed";
    return {
      ok: true,
      pending,
      message: pending
        ? `Queued ⏳ ${amount} ${draft.asset} on ${draft.network}.\n\n` +
          `It hasn't left yet — I've handed it to the chain and it usually goes through in a few minutes. ` +
          `Your history will show **Sent** once it confirms, and if it doesn't go through your balance comes back automatically. ` +
          `Don't send it again.`
        : draft.kind === "crypto"
          ? `Sent ✅ ${amount} ${draft.asset} on ${draft.network}.`
          : `Sent ✅ ${money(amount)} to ${draft.accountName}.`,
    };
  }

  const body = (await res.json().catch(() => ({}))) as { error?: string };
  const wrongPin = res.status === 401 || res.status === 428;
  return {
    ok: false,
    wrongPin,
    message: body.error ?? "That didn't go through. Try again from the app.",
  };
}

/**
 * Set a transfer up for later instead of sending it now.
 *
 * The PIN is checked HERE and never stored — the authorisation happens while
 * the user is present, exactly as it does for an immediate transfer, and what
 * runs at the appointed time is a server-signed single-use token standing in
 * for it (see lib/scheduled-transfer.ts).
 *
 * Deliberately does NOT reserve the money. Holding a balance for three days to
 * guarantee one payment is how an app quietly freezes funds people need; the
 * send at the appointed time is funded from every wallet, like any other, and
 * says so if it comes up short.
 */
/**
 * Pass as the PIN when the surface already authorised the transfer another way
 * — WhatsApp and SMS spend a single-use code instead, because neither can
 * delete a message afterwards.
 */
export const PRE_AUTHORISED = "\u0000pre-authorised";

export async function scheduleDraft(
  draft: {
    id: string;
    userId: string;
    kind?: string;
    amount: unknown;
    fiat: string;
    chatId: string;
    accountNumber: string | null;
    bankName: string | null;
    accountName: string | null;
    resolvedName: string | null;
    scheduleAt: Date | null;
    scheduleSaid: string | null;
  },
  pin: string,
): Promise<SendOutcome> {
  const amount = Number(draft.amount);
  const money = (n: number) => `${draft.fiat === "NGN" ? "₦" : draft.fiat + " "}${n.toLocaleString("en-US")}`;

  if (draft.kind === "crypto" || !draft.bankName || !draft.accountNumber || !draft.scheduleAt) {
    return { ok: false, wrongPin: false, message: "I can only schedule bank transfers, and I still need the details." };
  }

  // A chat that can't delete messages authorises with a single-use code, and
  // the caller has already spent one. Asking for the PIN as well would be
  // asking for the thing we have just told the user we never ask for.
  if (pin !== PRE_AUTHORISED) try {
    await requireWithdrawPin(draft.userId, pin);
  } catch (e) {
    const status = (e as { status?: number }).status;
    return {
      ok: false,
      wrongPin: status === 401,
      message: (e as Error).message ?? "That PIN isn't right.",
    };
  }

  const problem = scheduleProblem(draft.scheduleAt);
  if (problem) return { ok: false, wrongPin: false, message: problem.message };

  await scheduleBankTransfer({
    userId: draft.userId,
    runAt: draft.scheduleAt,
    said: draft.scheduleSaid ?? "later",
    fiat: draft.fiat,
    symbol: draft.fiat,
    amount,
    bankName: draft.bankName,
    accountNumber: draft.accountNumber,
    accountName: draft.resolvedName ?? draft.accountName,
    chatId: draft.chatId,
  });

  return {
    ok: true,
    message:
      `Scheduled ⏳ ${money(amount)} to ${draft.resolvedName ?? draft.accountName} — ` +
      `${draft.scheduleSaid ?? "later"}.\n\n` +
      `Nothing has left your balance yet. I'll send it then and tell you either way. ` +
      `Send /scheduled to see it or cancel it.`,
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
