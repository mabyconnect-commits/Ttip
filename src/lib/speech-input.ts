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
    // `e.results` is CUMULATIVE — it holds every result so far, not just the
    // new one. Appending to a running string on each event therefore counted
    // finalised words again and again ("send send five send five k"). Rebuild
    // from the list each time instead.
    let final = "";
    let interim = "";
    for (let i = 0; i < e.results.length; i += 1) {
      const r = e.results[i];
      const text = r[0]?.transcript ?? "";
      if (r.isFinal) final += text;
      else interim += text;
    }
    finalText = final;
    opts.onPartial?.((final + interim).trim());
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

/* ------------------------------------------------------------------------ */
/* Recording, for when the browser's own recogniser doesn't deliver          */
/* ------------------------------------------------------------------------ */

/**
 * Record from the microphone.
 *
 * The browser recogniser is the fast path, but it fails silently: another app
 * holding the mic, an in-app browser, an older iOS Safari — the "Listening…"
 * indicator sits there and no words ever arrive. Recording in parallel costs
 * nothing when the recogniser works and is the difference between working and
 * not when it doesn't.
 */
export interface Recording {
  /** Stop and hand back what was captured. Null if nothing usable was. */
  stop(): Promise<Blob | null>;
  /** Stop and throw it away. */
  cancel(): void;
}

export function recordingSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

/** The best container this browser will actually produce. */
function pickMimeType(): string | undefined {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4", // Safari
  ];
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return undefined;
}

export async function record(): Promise<Recording | null> {
  if (!recordingSupported()) return null;

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return null; // permission refused, or no microphone
  }

  const mimeType = pickMimeType();
  const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  // Timeslice so a clip is never lost when the tab is backgrounded mid-record.
  rec.start(1000);

  const release = () => stream.getTracks().forEach((t) => t.stop());

  return {
    stop: () =>
      new Promise<Blob | null>((resolve) => {
        if (rec.state === "inactive") {
          release();
          resolve(null);
          return;
        }
        rec.onstop = () => {
          release();
          const blob = new Blob(chunks, { type: mimeType ?? "audio/webm" });
          resolve(blob.size > 1000 ? blob : null);
        };
        rec.stop();
      }),
    cancel: () => {
      try {
        if (rec.state !== "inactive") rec.stop();
      } catch {
        /* already stopped */
      }
      release();
    },
  };
}

/** Send a clip to the server to be transcribed. Returns null on any failure. */
export async function transcribeBlob(blob: Blob): Promise<{ text?: string; error?: string }> {
  const form = new FormData();
  const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
  form.append("audio", blob, `voice.${ext}`);
  try {
    const res = await fetch("/api/assistant/transcribe", { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data?.error ?? "I couldn't make that out." };
    return { text: data?.text };
  } catch {
    return { error: "Couldn't reach the server to read that back." };
  }
}
