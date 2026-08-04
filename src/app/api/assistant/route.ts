import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized, ApiError } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { ttipKnowledge, assistantRules, ASSISTANT_NAME } from "@/lib/assistant/knowledge";
import { buildUserContext } from "@/lib/assistant/context";
import { cleanAssistantText } from "@/lib/assistant/sanitize";
import { answerFaq } from "@/lib/assistant/faq";
import { parseTransferIntent, parseBillIntent } from "@/lib/assistant/intent";
import { buildBillDraft } from "@/lib/assistant/bill-draft";
import { bankAliases } from "@/lib/bank-aliases";
import { prisma } from "@/lib/db";

/**
 * Ada — the in-app assistant.
 *
 * Answers are streamed so the reply starts appearing immediately instead of the
 * user watching a spinner for several seconds.
 *
 * Three things this route is careful about:
 *
 *  1. The account context is loaded from the SESSION user id, never from the
 *     request body, so nobody can ask about another person's account.
 *  2. Every chunk is passed through cleanAssistantText before it leaves the
 *     server, so tool/function markup can never reach the chat bubble.
 *  3. It is rate limited per user — this endpoint costs money per call.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = "claude-opus-5";
// Adaptive thinking spends from the same budget, so this is deliberately well
// above what a two-sentence support answer needs — a reply truncated mid-number
// on a fee question is worse than a slightly longer one.
const MAX_TOKENS = 4000;
const MAX_TURNS = 20;

const schema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(2000),
      }),
    )
    .min(1)
    .max(MAX_TURNS),
});

/**
 * Whether the MODEL is available. The chat itself is always available — see
 * below. Next only allows route handlers and its own config to be exported from
 * a route file, so this stays local rather than becoming a shared helper.
 */
function aiEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * `enabled` is always true: support chat must not depend on an environment
 * variable. Without a key the built-in answers reply instead, so the launcher
 * always appears. `ai` says which brain is answering.
 */
export async function GET() {
  return handler(async () => ok({ enabled: true, ai: aiEnabled(), name: ASSISTANT_NAME }));
}

/** Stream a plain string back in the same SSE shape the model uses. */
function streamText(text: string, escalate: boolean, action?: unknown): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (o: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(o)}\n\n`));
      send({ t: "delta", text });
      if (action) send({ t: "action", action });
      send({ t: "done", escalate });
      controller.close();
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  try {
    // Chat is cheap for the user and expensive for us; cap both burst and volume.
    rateLimit(`assistant:${userId}`, { limit: 12, windowMs: 60_000 });
    rateLimit(`assistant-day:${userId}`, { limit: 150, windowMs: 24 * 60 * 60_000 });

    const { messages } = schema.parse(await req.json());

    // The last turn must be the user's — otherwise there's nothing to answer.
    if (messages[messages.length - 1]!.role !== "user") {
      throw new ApiError("Nothing to answer.", 400);
    }

    const question = messages[messages.length - 1]!.content;

    // "Ada buy me ₦100 airtime", "send 1GB to my MTN line".
    //
    // Same rule as transfers: Ada prepares, the user confirms with their PIN.
    // The number is one they've topped up before unless they typed a new one —
    // a model inventing a digit sends someone else's airtime, and there's no
    // way back from that.
    const bill = parseBillIntent(question);
    if (bill) {
      const outcome = await buildBillDraft(userId, bill);
      return streamText(outcome.message, false, outcome.draft);
    }

    // "Help me transfer 7,500 to my GTBank account."
    //
    // Ada never moves money. She turns the request into a DRAFT matched against
    // the user's own saved beneficiaries, and the client makes them confirm it
    // with their transaction PIN — after which the normal /api/send path runs
    // every check it always did. The destination can only be something they
    // already saved, so an account number typed into a chat window (which is
    // exactly how people get talked into paying a scammer) can never be used.
    const intent = parseTransferIntent(question);
    if (intent) {
      const [me, beneficiaries] = await Promise.all([
        prisma.user.findUnique({ where: { id: userId }, select: { defaultFiat: true, bankName: true } }),
        prisma.beneficiary.findMany({ where: { userId, type: "bank" }, take: 25 }),
      ]);
      const fiat = me?.defaultFiat ?? "NGN";
      const wanted = (intent.target ?? "").replace(/^@/, "").toLowerCase();
      const match =
        beneficiaries.find((b) => b.name.toLowerCase().includes(wanted) && wanted.length > 1) ??
        beneficiaries.find((b) => b.detail.toLowerCase().includes(wanted) && wanted.length > 1) ??
        (beneficiaries.length === 1 ? beneficiaries[0] : undefined);

      if (!match) {
        const listed = beneficiaries.length
          ? ` You have ${beneficiaries.map((b) => b.name).join(", ")} saved — say which one.`
          : " You don't have any saved bank accounts yet — add one on the Send out screen and I can use it next time.";
        return streamText(
          `I can set up ${fiat} ${intent.amount.toLocaleString("en-US")}, but I need to know where it's going.${listed}`,
          false,
        );
      }

      return streamText(
        `Ready to send ${fiat} ${intent.amount.toLocaleString("en-US")} to ${match.name}. ` +
          `Check it and confirm with your PIN — I can't move money myself.`,
        false,
        {
          kind: "transfer",
          amount: intent.amount,
          fiat,
          beneficiaryName: match.name,
          accountNumber: match.detail,
          bankName: match.handle ?? me?.bankName ?? null,
        },
      );
    }

    // No key? Answer from the built-in knowledge rather than telling the user
    // the assistant is switched off. A plain answer beats no support chat.
    if (!aiEnabled()) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, kycTier: true, kycStatus: true, nairaAccount: true, nairaBank: true },
      });
      const a = answerFaq(question, {
        name: user?.name,
        tier: user?.kycTier ?? 0,
        kycStatus: user?.kycStatus,
        nairaAccount: user?.nairaAccount,
        nairaBank: user?.nairaBank,
        bankAliases: bankAliases(user?.nairaBank),
      });
      return streamText(a.text, a.escalate);
    }

    const context = await buildUserContext(userId);
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

    const turns = messages.map((m) => ({ role: m.role, content: m.content }));
    const system = [
      {
        type: "text" as const,
        text: `${assistantRules()}\n\n${ttipKnowledge()}`,
        // Identical on every request, so it's worth caching.
        cache_control: { type: "ephemeral" as const },
      },
      { type: "text" as const, text: context },
    ];

    // Adaptive lets the model spend nothing on "what's my limit?" and think
    // properly on "my transfer is pending and the money left my bank" — but it
    // is not accepted by every model, so a rejected request is retried without
    // it rather than failing the whole conversation.
    const openStream = (thinking: boolean) =>
      client.messages.stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        ...(thinking ? { thinking: { type: "adaptive" as const } } : {}),
        system,
        messages: turns,
      });

    /** The built-in answer, used whenever the model can't be reached. */
    const fallback = async () => {
      const u = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, kycTier: true, kycStatus: true, nairaAccount: true, nairaBank: true },
      });
      return answerFaq(question, {
        name: u?.name,
        tier: u?.kycTier ?? 0,
        kycStatus: u?.kycStatus,
        nairaAccount: u?.nairaAccount,
        nairaBank: u?.nairaBank,
        bankAliases: bankAliases(u?.nairaBank),
      });
    };

    const encoder = new TextEncoder();

    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (obj: unknown) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

        let raw = "";
        let sent = 0; // how much of the CLEANED text the client already has
        let stopReason: string | null = null;

        /** Drain one attempt. Returns false if it failed before emitting text. */
        const run = async (thinking: boolean): Promise<boolean> => {
          const stream = openStream(thinking);
          for await (const event of stream) {
            if (event.type === "message_delta") {
              stopReason = event.delta.stop_reason ?? stopReason;
              continue;
            }
            if (event.type !== "content_block_delta") continue;
            // thinking_delta is internal — it must never reach the user.
            if (event.delta.type !== "text_delta") continue;

            raw += event.delta.text;

            // Re-clean the whole message each time and emit only what's new, so
            // markup split across two chunks is still caught.
            const clean = cleanAssistantText(raw, true).text;
            if (clean.length > sent) {
              send({ t: "delta", text: clean.slice(sent) });
              sent = clean.length;
            }
          }
          return true;
        };

        try {
          try {
            await run(true);
          } catch (err) {
            // Nothing reached the user yet, so a second attempt is safe. The
            // usual cause is the model rejecting `thinking`.
            if (sent > 0) throw err;
            console.error("[assistant] retrying without adaptive thinking", err);
            raw = "";
            await run(false);
          }

          const final = cleanAssistantText(raw, false);

          if (stopReason === "refusal") {
            send({
              t: "error",
              message: "I can't help with that one. Email support if it's about your account.",
            });
          } else if (!final.text) {
            // Nothing usable came back (all thinking, or the budget ran out).
            send({
              t: "error",
              message: "I couldn't get that one out. Try asking it a shorter way, or email support.",
            });
          } else {
            // Flush any trailing text the streaming pass was holding back.
            if (final.text.length > sent) send({ t: "delta", text: final.text.slice(sent) });
            send({ t: "done", escalate: final.escalate });
          }
        } catch (err) {
          // The model is unreachable — misconfigured key, rate limit, outage.
          // Answer from the built-in knowledge rather than showing an error;
          // the user asked a real question and deserves a real reply.
          console.error("[assistant] model unavailable, using built-in answers", err);
          try {
            const a = await fallback();
            if (sent === 0) {
              send({ t: "delta", text: a.text });
              send({ t: "done", escalate: a.escalate });
            } else {
              send({ t: "done", escalate: true });
            }
          } catch {
            send({
              t: "error",
              message: "I lost that one — say it again? If it keeps happening, email support.",
            });
          }
        } finally {
          controller.close();
        }
      },
    });

    return new Response(body, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // Vercel/nginx must not buffer, or streaming turns into one big blob.
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    // Errors thrown before the stream opens still return normal JSON.
    return handler(async () => {
      throw err;
    });
  }
}
