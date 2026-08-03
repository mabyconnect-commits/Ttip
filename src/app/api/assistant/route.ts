import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized, ApiError } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { ttipKnowledge, assistantRules, ASSISTANT_NAME } from "@/lib/assistant/knowledge";
import { buildUserContext } from "@/lib/assistant/context";
import { cleanAssistantText } from "@/lib/assistant/sanitize";

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
 * Next only allows route handlers and its own config to be exported from a
 * route file, so this stays local rather than becoming a shared helper.
 */
function assistantEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/** Lets the client hide the launcher entirely when no key is configured. */
export async function GET() {
  return handler(async () => ok({ enabled: assistantEnabled(), name: ASSISTANT_NAME }));
}

export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return unauthorized();

  try {
    if (!assistantEnabled()) {
      throw new ApiError(
        `${ASSISTANT_NAME} isn't switched on yet. Email support and a human will help you.`,
        503,
      );
    }

    // Chat is cheap for the user and expensive for us; cap both burst and volume.
    rateLimit(`assistant:${userId}`, { limit: 12, windowMs: 60_000 });
    rateLimit(`assistant-day:${userId}`, { limit: 150, windowMs: 24 * 60 * 60_000 });

    const { messages } = schema.parse(await req.json());

    // The last turn must be the user's — otherwise there's nothing to answer.
    if (messages[messages.length - 1]!.role !== "user") {
      throw new ApiError("Nothing to answer.", 400);
    }

    const context = await buildUserContext(userId);
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Adaptive lets the model spend nothing on "what's my limit?" and think
      // properly on "my transfer is pending and the money left my bank".
      thinking: { type: "adaptive" },
      system: [
        {
          type: "text",
          text: `${assistantRules()}\n\n${ttipKnowledge()}`,
          // Identical on every request, so it's worth caching.
          cache_control: { type: "ephemeral" },
        },
        { type: "text", text: context },
      ],
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });

    const encoder = new TextEncoder();

    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (obj: unknown) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

        let raw = "";
        let sent = 0; // how much of the CLEANED text the client already has
        let stopReason: string | null = null;

        try {
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
          console.error("[assistant] stream failed", err);
          send({
            t: "error",
            message: "I lost that one — say it again? If it keeps happening, email support.",
          });
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
