/**
 * Talking to Ada instead of typing.
 *
 * Uses the browser's own speech recognition rather than uploading audio: it
 * costs nothing, needs no API key, and the words appear as you speak instead of
 * after a round trip. On Android Chrome and iOS Safari that's the whole feature.
 *
 * `en-NG` is requested first. It matters more than it looks: a US-English model
 * hears "send seven k to my sister" as almost anything else, and "k" for
 * thousand is not a US idiom at all. Browsers that don't have Nigerian English
 * fall back on their own.
 *
 * Dependency-free and guarded, so it can be imported anywhere and simply
 * reports unsupported where the API doesn't exist.
 */

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

type Ctor = new () => SpeechRecognitionLike;

function ctor(): Ctor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechSupported(): boolean {
  return ctor() !== null;
}

export interface Listener {
  /** Stop and keep whatever was heard. */
  stop(): void;
  /** Stop and discard. */
  cancel(): void;
}

/**
 * Start listening.
 *
 * `onPartial` fires as the words firm up, so the user can see they're being
 * heard; `onFinal` fires once with the finished sentence. `onEnd` always runs,
 * including on error, so a caller can't get stuck showing "listening…".
 */
export function listen(opts: {
  onPartial?: (text: string) => void;
  onFinal: (text: string) => void;
  onError?: (reason: string) => void;
  onEnd?: () => void;
  lang?: string;
}): Listener | null {
  const C = ctor();
  if (!C) return null;

  const rec = new C();
  rec.lang = opts.lang ?? "en-NG";
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  let finalText = "";
  let cancelled = false;

  rec.onresult = (e) => {
    let interim = "";
    for (let i = 0; i < e.results.length; i += 1) {
      const r = e.results[i];
      const text = r[0]?.transcript ?? "";
      if (r.isFinal) finalText += text;
      else interim += text;
    }
    opts.onPartial?.((finalText + interim).trim());
  };

  rec.onerror = (e) => {
    const reason = e?.error ?? "unknown";
    // "aborted" is what cancel() produces — not something to report.
    if (reason !== "aborted" && reason !== "no-speech") opts.onError?.(reason);
  };

  rec.onend = () => {
    if (!cancelled) {
      const text = finalText.trim();
      if (text) opts.onFinal(text);
    }
    opts.onEnd?.();
  };

  try {
    rec.start();
  } catch {
    opts.onEnd?.();
    return null;
  }

  return {
    stop: () => rec.stop(),
    cancel: () => {
      cancelled = true;
      rec.abort();
    },
  };
}

/** A human explanation for the errors that actually happen. */
export function speechErrorMessage(reason: string): string {
  if (reason === "not-allowed" || reason === "service-not-allowed") {
    return "I need microphone permission — allow it in your browser settings and try again.";
  }
  if (reason === "network") return "Speech recognition needs a connection. Check your data and try again.";
  if (reason === "audio-capture") return "I couldn't find a microphone on this device.";
  return "I couldn't hear that — try again, or type it.";
}
