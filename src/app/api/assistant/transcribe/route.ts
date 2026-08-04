import { getUserId } from "@/lib/auth";
import { handler, ok, unauthorized, ApiError } from "@/lib/api";
import { transcribe, speechEnabled } from "@/lib/assistant/speech";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Turn a recorded clip into text.
 *
 * The browser's own speech recognition is the fast path — free, instant, no
 * upload — but it is not dependable. It goes quiet when another app holds the
 * microphone, it is missing or half-implemented in in-app browsers and older
 * iOS Safari, and when it fails it fails SILENTLY: the "Listening…" indicator
 * sits there and no words ever arrive, which is exactly what a user sees as
 * "the voice note doesn't work".
 *
 * So the app also records the audio, and when the browser produced nothing the
 * recording is sent here instead. Same transcriber the Telegram bot uses.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

/** About a minute of Opus. Longer than anyone says "send 5k to my sister". */
const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(req: Request) {
  return handler(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized();

    if (!speechEnabled()) {
      throw new ApiError(
        "Voice isn't switched on yet — type it and I'll do it right away.",
        503,
      );
    }

    try {
      rateLimit(`stt:${userId}`, { limit: 20, windowMs: 5 * 60_000 });
    } catch {
      throw new ApiError("That's a lot of recordings at once — give it a minute.", 429);
    }

    const form = await req.formData().catch(() => null);
    const file = form?.get("audio");
    if (!(file instanceof Blob)) throw new ApiError("No audio received.", 400);
    if (file.size === 0) throw new ApiError("That recording was empty.", 400);
    if (file.size > MAX_BYTES) throw new ApiError("That recording is too long — keep it under a minute.", 413);

    const buffer = Buffer.from(await file.arrayBuffer());
    const text = await transcribe(buffer, file.type || "audio/webm");

    if (!text) {
      throw new ApiError("I couldn't make that out — say it again, or type it.", 422);
    }
    return ok({ text });
  });
}
