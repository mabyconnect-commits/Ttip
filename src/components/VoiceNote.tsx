"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";

/**
 * A voice note in the chat — the clip itself, playable, not a line of text.
 *
 * Deliberately plays from the length we measured while recording rather than
 * the file's own metadata: MediaRecorder writes WebM/Opus with no duration
 * header, so `audio.duration` comes back Infinity in Chrome and the bar would
 * never move. We know exactly how long the recording ran, so we use that.
 *
 * Once the chat is restored from storage the clip is gone — it only ever lived
 * in memory — so the bubble then shows without a play button rather than
 * offering one that does nothing.
 */

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** A fixed bar pattern. We don't analyse the waveform; this just reads as one. */
const BARS = [
  6, 11, 8, 16, 22, 14, 9, 19, 26, 17, 11, 21, 15, 24, 12, 8, 18, 13, 20, 10, 15, 7, 12, 9,
];

export function VoiceNote({
  url,
  ms,
  tone = "mine",
}: {
  /** Absent once the thread has been restored — the clip lived in memory only. */
  url?: string;
  ms: number;
  tone?: "mine" | "theirs";
}) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);

  // Stop and release when the bubble goes away mid-play.
  useEffect(() => {
    const el = audio.current;
    return () => {
      el?.pause();
    };
  }, []);

  const progress = ms > 0 ? Math.min(1, at / (ms / 1000)) : 0;
  const accent = tone === "mine" ? "#3DF5B0" : "#2AC8FF";

  function toggle() {
    const el = audio.current;
    if (!el) return;
    if (playing) {
      el.pause();
      return;
    }
    // Replay from the start once it has finished.
    if (progress >= 0.999) el.currentTime = 0;
    void el.play().catch(() => setPlaying(false));
  }

  return (
    <div className="flex items-center gap-3 min-w-[190px]">
      {url ? (
        <>
          <audio
            ref={audio}
            src={url}
            preload="metadata"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => {
              setPlaying(false);
              setAt(0);
            }}
            onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
          />
          <button
            onClick={toggle}
            aria-label={playing ? "Pause" : "Play voice note"}
            className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 active:scale-95"
            style={{ background: `${accent}22`, color: accent }}
          >
            <Icon name={playing ? "pause" : "play"} size={15} />
          </button>
        </>
      ) : (
        <span
          className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
          style={{ background: "rgb(var(--fg) / .08)", color: "rgb(var(--fg) / .45)" }}
        >
          <Icon name="mic" size={15} />
        </span>
      )}

      <div className="flex items-center gap-[3px] flex-1 h-6">
        {BARS.map((h, i) => (
          <span
            key={i}
            className="flex-1 rounded-full transition-colors"
            style={{
              height: `${h}px`,
              minWidth: 2,
              background: i / BARS.length <= progress && url ? accent : "rgb(var(--fg) / .22)",
            }}
          />
        ))}
      </div>

      <span className="font-sans text-[11px] tabular-nums text-white/45 shrink-0">
        {formatClock(playing || at > 0 ? at * 1000 : ms)}
      </span>
    </div>
  );
}
