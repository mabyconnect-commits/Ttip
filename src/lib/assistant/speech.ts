import "server-only";

/**
 * Turning a voice note into text.
 *
 * Worth being plain about why this file exists at all: Claude cannot take audio
 * input. In the app we don't need it — the browser's own speech recognition
 * turns the mic into text before anything leaves the phone, free and instant.
 * But a Telegram voice note arrives as an OGG/Opus file on the server, with no
 * browser anywhere, so transcribing it needs a service that accepts audio.
 *
 * So this is a small adapter over whichever one you have a key for, and it is
 * OPTIONAL: with no key configured, voice notes get a polite "type it and I'll
 * do it" rather than silence. Nothing else in the bot depends on it.
 *
 *   SPEECH_PROVIDER   deepgram | openai   (default: whichever key is set)
 *   DEEPGRAM_API_KEY  https://deepgram.com — cheapest for short clips
 *   OPENAI_API_KEY    Whisper via /v1/audio/transcriptions
 *
 * Nigerian English is the reason `language` is left to the provider's
 * multilingual default rather than pinned to en-US: "send seven k to my
 * sister" transcribes badly under a US-English model.
 */

export function speechEnabled(): boolean {
  return !!(process.env.DEEPGRAM_API_KEY || process.env.OPENAI_API_KEY);
}

function provider(): "deepgram" | "openai" | null {
  const forced = process.env.SPEECH_PROVIDER?.toLowerCase();
  if (forced === "deepgram") return process.env.DEEPGRAM_API_KEY ? "deepgram" : null;
  if (forced === "openai") return process.env.OPENAI_API_KEY ? "openai" : null;
  if (process.env.DEEPGRAM_API_KEY) return "deepgram";
  if (process.env.OPENAI_API_KEY) return "openai";
  return null;
}

/** Transcribe audio. Returns null when it can't — never throws at the caller. */
export async function transcribe(audio: Buffer, mime = "audio/ogg"): Promise<string | null> {
  const which = provider();
  if (!which) return null;
  try {
    const text = which === "deepgram" ? await deepgram(audio, mime) : await openai(audio, mime);
    const clean = (text ?? "").trim();
    return clean || null;
  } catch (e) {
    console.error("[speech] transcription failed", e);
    return null;
  }
}

async function deepgram(audio: Buffer, mime: string): Promise<string | null> {
  const res = await fetch("https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true", {
    method: "POST",
    headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`, "Content-Type": mime },
    body: new Uint8Array(audio),
  });
  if (!res.ok) {
    console.error("[speech] deepgram", res.status, (await res.text()).slice(0, 200));
    return null;
  }
  const json = (await res.json()) as {
    results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
  };
  return json.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? null;
}

async function openai(audio: Buffer, mime: string): Promise<string | null> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), fileNameFor(mime));
  form.append("model", "whisper-1");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) {
    console.error("[speech] openai", res.status, (await res.text()).slice(0, 200));
    return null;
  }
  const json = (await res.json()) as { text?: string };
  return json.text ?? null;
}

/** Whisper picks its decoder from the extension, so the name has to be right. */
function fileNameFor(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("ogg") || m.includes("opus")) return "voice.ogg";
  if (m.includes("mpeg") || m.includes("mp3")) return "voice.mp3";
  if (m.includes("wav")) return "voice.wav";
  if (m.includes("m4a") || m.includes("mp4")) return "voice.m4a";
  if (m.includes("webm")) return "voice.webm";
  return "voice.ogg";
}
