import crypto from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { parseSms, matchName } from "@/lib/sms/parse";
import { normalisePhone, sendSms, smsEnabled } from "@/lib/sms/provider";
import { nextCodeIndex, spendCode, codesLeft, LOW_CODES } from "@/lib/sms/codes";
import { smsMaxTransfer, smsDailyCap, withinCaps } from "@/lib/sms/limits";
import { pendingSms, clearSms, startSmsTransfer, sentByChatToday, sendChatTransfer } from "@/lib/sms/session";
import { spendableFiat } from "@/lib/spendable";
import { COMPANY } from "@/lib/company";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Sending money with no data at all.
 *
 * A text message, on any phone, over the carrier's own network. The whole
 * design turns on one problem: SMS cannot carry a PIN. It is reusable, it stays
 * in the sent-items folder, it crosses the carrier's SMSC in the clear, and
 * unlike the Telegram bot we cannot delete it afterwards. Anything reusable
 * sent in plaintext is a credential given away.
 *
 * So four rules do the work, and none of them is optional:
 *
 *  1. The NUMBER must be bound to the account from inside the signed-in app.
 *     SMS sender ids are spoofable — a message arriving "from" a number proves
 *     nothing on its own.
 *  2. Money only goes to a SAVED beneficiary. A stolen phone cannot invent a
 *     destination; it can only pay someone its owner already paid.
 *  3. Authorisation is a SINGLE-USE code from a sheet the user got while
 *     online, asked for by number. Read one over a shoulder and it is already
 *     spent; it tells you nothing about the next.
 *  4. The caps are the smallest in the app, because this is the weakest surface
 *     in it.
 *
 * Every inbound message is recorded, keyed on the aggregator's message id — so
 * a carrier that retries a delivery cannot send the money twice.
 */

/** What the aggregators actually post. Termii and Africa's Talking differ. */
interface Inbound {
  id: string;
  from: string;
  text: string;
}

function readInbound(body: Record<string, unknown>): Inbound | null {
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = body[k];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (typeof v === "number") return String(v);
    }
    return "";
  };
  const from = pick("from", "msisdn", "sender", "phone_number", "phoneNumber");
  const text = pick("text", "message", "sms", "body", "content");
  // No id from the provider means we cannot dedupe, so we make one that is
  // stable for the same message within the same minute — a retry inside that
  // window still collides, which is what retries do.
  const id =
    pick("id", "messageId", "message_id", "linkId") ||
    `${from}:${Math.floor(Date.now() / 60_000)}:${text.slice(0, 40)}`;
  if (!from || !text) return null;
  return { id, from, text };
}

const money = (n: number, fiat = "NGN") =>
  `${fiat === "NGN" ? "₦" : fiat + " "}${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

const HELP =
  `Ttip by text:\n` +
  `BAL — your balance\n` +
  `LIST — who you can pay\n` +
  `SEND 2000 MAMA — pay a saved person\n` +
  `Then reply with the code we ask for.\n` +
  `Everything else: ${COMPANY.domain}`;

/**
 * Is this really our aggregator?
 *
 * Without this, anyone who knows the URL can POST {from, text} and the system
 * treats it as a text from that person's phone — which is an instruction to
 * move their money. The confirmation code is a second line of defence, but a
 * caller who can forge inbound messages can also forge code guesses, so the
 * door has to be shut at the front.
 *
 * The secret is checked against a header, a query parameter, or a field in the
 * body, because aggregators differ in where they will put one. Set the same
 * value in Termii under Settings → Webhooks and in SMS_WEBHOOK_SECRET.
 *
 * Unset means REJECT, not allow. A deployment that forgets the secret must go
 * quiet rather than accept anything the internet sends it.
 */
function authorised(req: Request, url: URL, body: Record<string, unknown>): boolean {
  const secret = process.env.SMS_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.error("[sms] SMS_WEBHOOK_SECRET is not set — inbound rejected");
    return false;
  }
  const offered = [
    req.headers.get("x-webhook-secret"),
    req.headers.get("x-termii-signature"),
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, ""),
    url.searchParams.get("secret"),
    typeof body.secret === "string" ? body.secret : null,
  ].filter((v): v is string => !!v && v.length > 0);

  return offered.some((candidate) => {
    const a = Buffer.from(candidate);
    const b = Buffer.from(secret);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

export async function POST(req: Request) {
  // Always 200. An aggregator that gets an error retries, and a retried
  // money instruction is the one thing worse than a dropped one.
  try {
    const raw = await req
      .json()
      .catch(async () => Object.fromEntries(new URLSearchParams(await req.text())));
    // Checked before anything is parsed or acted on.
    if (!authorised(req, new URL(req.url), raw as Record<string, unknown>)) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const msg = readInbound(raw as Record<string, unknown>);
    if (!msg) return NextResponse.json({ ok: true });

    const phone = normalisePhone(msg.from);
    if (!phone) return NextResponse.json({ ok: true });

    // Already handled — a retry, not a second instruction.
    const seen = await prisma.smsCommand.findUnique({ where: { providerId: msg.id } });
    if (seen) return NextResponse.json({ ok: true, duplicate: true });

    const reply = await handle(phone, msg.text);

    await prisma.smsCommand
      .create({
        data: {
          providerId: msg.id,
          phone,
          body: msg.text.slice(0, 320),
          userId: reply.userId ?? null,
          outcome: reply.outcome,
          reply: reply.text?.slice(0, 320) ?? null,
        },
      })
      .catch(() => {
        /* a duplicate id racing us — the reply is already going out */
      });

    if (reply.text && smsEnabled()) await sendSms(phone, reply.text);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[sms] webhook failed", e);
    return NextResponse.json({ ok: true });
  }
}

interface Handled {
  outcome: string;
  text?: string;
  userId?: string;
}

async function handle(phone: string, body: string): Promise<Handled> {
  // A brake on someone grinding codes by SMS. Generous enough for a real
  // conversation, tight enough that a sheet can't be searched.
  try {
    rateLimit(`sms:${phone}`, { limit: 10, windowMs: 10 * 60_000 });
  } catch {
    return { outcome: "rate-limited" };
  }

  const link = await prisma.phoneLink.findUnique({ where: { phone } });
  if (!link?.verifiedAt) {
    return {
      outcome: "unlinked",
      text: `This number isn't linked to a ${COMPANY.product} account. Open ${COMPANY.domain} → Account → SMS to link it.`,
    };
  }
  const userId = link.userId;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { defaultFiat: true, kycStatus: true, balances: true },
  });
  if (!user) return { outcome: "no-user" };
  const fiat = user.defaultFiat;

  const cmd = parseSms(body);

  if (cmd.kind === "help" || cmd.kind === "unknown") {
    return { outcome: cmd.kind, userId, text: HELP };
  }

  if (cmd.kind === "cancel") {
    await clearSms(phone);
    return { outcome: "cancelled", userId, text: "Cancelled. Nothing was sent." };
  }

  if (cmd.kind === "balance") {
    const spend = await spendableFiat(user.balances, fiat).catch(() => null);
    return {
      outcome: "balance",
      userId,
      text: spend
        ? `You can send ${money(spend.total, fiat)} — that's every wallet together, converted as it sends.`
        : `Couldn't read your balance right now. Try again shortly.`,
    };
  }

  if (cmd.kind === "list") {
    const saved = await prisma.beneficiary.findMany({ where: { userId, type: "bank" }, take: 10 });
    const usable = saved.filter((b) => b.handle && b.detail);
    return {
      outcome: "list",
      userId,
      text: usable.length
        ? `You can pay: ${usable.map((b) => b.name).join(", ")}.\nSend like: SEND 2000 ${usable[0].name.split(" ")[0].toUpperCase()}`
        : `You have nobody saved yet. Pay someone once from the app and they'll be here.`,
    };
  }

  // A code, answering the question we asked.
  if (cmd.kind === "code") {
    const draft = await pendingSms(phone);
    if (!draft) {
      return { outcome: "code-no-draft", userId, text: "Nothing is waiting for a code. Text SEND to start one." };
    }
    const index = await nextCodeIndex(userId);
    if (index === null) {
      await clearSms(phone);
      return { outcome: "out-of-codes", userId, text: `You're out of codes. Get a new sheet at ${COMPANY.domain} → Account → SMS.` };
    }
    if (!(await spendCode(userId, index, cmd.code))) {
      // Three wrong codes and the transfer dies rather than becoming a target.
      const tries = await prisma.telegramDraft
        .update({ where: { id: draft.id }, data: { attempts: { increment: 1 } }, select: { attempts: true } })
        .then((d) => d.attempts)
        .catch(() => 3);
      if (tries >= 3) {
        await clearSms(phone);
        return { outcome: "code-wrong-final", userId, text: "Wrong code too many times. Transfer cancelled, nothing sent." };
      }
      return { outcome: "code-wrong", userId, text: `That code isn't right. Reply with code #${index}, or CANCEL.` };
    }

    await clearSms(phone);
    const result = await sendChatTransfer(draft);
    const left = await codesLeft(userId);
    const warn = left <= LOW_CODES ? `\n${left} codes left — get more at ${COMPANY.domain}.` : "";
    return { outcome: result.ok ? "sent" : "send-failed", userId, text: result.message + warn };
  }

  // SEND — the only thing here that moves money.
  if (user.kycStatus !== "verified") {
    return { outcome: "unverified", userId, text: `Verify your BVN first — ${COMPANY.domain} → Account → Verify. It takes a minute.` };
  }

  const saved = await prisma.beneficiary.findMany({ where: { userId, type: "bank" } });
  const usable = saved.filter((b) => b.handle && b.detail);
  const who = matchName(cmd.to, usable);
  if (!who) {
    // Never a guess. Over SMS the user finds out it went to the wrong person
    // after it has gone, not on a screen they could have checked.
    return {
      outcome: "no-beneficiary",
      userId,
      text: usable.length
        ? `I couldn't tell who "${cmd.to}" is. Reply LIST to see the exact names.`
        : `You have nobody saved yet. Pay them once from the app first.`,
    };
  }

  const cap = withinCaps(cmd.amount, await sentByChatToday(userId), fiat);
  if (!cap.ok) return { outcome: "over-cap", userId, text: cap.reason! };

  const spend = await spendableFiat(user.balances, fiat).catch(() => null);
  if (spend && spend.total < cmd.amount) {
    return {
      outcome: "insufficient",
      userId,
      text: `You have ${money(spend.total, fiat)} across your wallets — not enough for ${money(cmd.amount, fiat)}.`,
    };
  }

  const index = await nextCodeIndex(userId);
  if (index === null) {
    return { outcome: "out-of-codes", userId, text: `You're out of codes. Get a new sheet at ${COMPANY.domain} → Account → SMS.` };
  }

  await startSmsTransfer({
    userId,
    phone,
    amount: cmd.amount,
    fiat,
    accountNumber: who.detail,
    bankName: who.handle!,
    accountName: who.name,
  });

  return {
    outcome: "awaiting-code",
    userId,
    text:
      `Send ${money(cmd.amount, fiat)} to ${who.name} (${who.detail}, ${who.handle})?\n` +
      `Reply with code #${index} to confirm, or CANCEL.`,
  };
}

/** Limits, for the linking screen to show without hardcoding them twice. */
export async function GET() {
  return NextResponse.json({ maxTransfer: smsMaxTransfer(), dailyCap: smsDailyCap() });
}
