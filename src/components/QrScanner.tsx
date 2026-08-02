"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

/**
 * Full-screen QR scanner backed by the device camera.
 *
 * Uses the native BarcodeDetector API where available (Android Chrome, most
 * Chromium browsers) — no third-party library, no bundle cost. On browsers that
 * lack it (notably iOS Safari today) we show a clear message and let the user
 * paste the address instead, so the flow never dead-ends.
 *
 * Crypto QR payloads are often URIs like `tron:TAbc…?amount=1` or
 * `ethereum:0x…@1` — we strip the scheme/params and return the bare address.
 */

function parseAddress(raw: string): string {
  let s = raw.trim();
  // Strip a `scheme:` prefix (bitcoin:, ethereum:, tron:, solana:, …).
  const scheme = s.match(/^[a-z][a-z0-9.+-]*:(.*)$/i);
  if (scheme) s = scheme[1];
  // Drop query params (?amount=…) and EIP-681 chain suffix (@1).
  s = s.split("?")[0].split("@")[0];
  return s.trim();
}

type Supported = "checking" | "yes" | "no";

export function QrScanner({ open, onClose, onResult }: { open: boolean; onClose: () => void; onResult: (address: string) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const [supported, setSupported] = useState<Supported>("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const BD = (window as any).BarcodeDetector;

    async function start() {
      if (!BD) {
        setSupported("no");
        return;
      }
      setSupported("yes");
      try {
        const detector = new BD({ formats: ["qr_code"] });
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play().catch(() => {});

        const tick = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes && codes.length && codes[0].rawValue) {
              const addr = parseAddress(String(codes[0].rawValue));
              if (addr) {
                stop();
                onResult(addr);
                onClose();
                return;
              }
            }
          } catch {
            /* transient decode error — keep scanning */
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch (e: any) {
        setError(e?.name === "NotAllowedError" ? "Camera access was blocked. Allow it in your browser settings, or paste the address." : "Couldn't start the camera. Paste the address instead.");
      }
    }

    function stop() {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [open, onClose, onResult]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <span className="font-grotesk font-semibold text-[15px] text-white">Scan QR code</span>
        <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white"><Icon name="x" size={16} /></button>
      </div>

      {supported !== "no" && !error && (
        <div className="flex-1 relative overflow-hidden">
          <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" muted playsInline />
          {/* framing reticle */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-[62vw] max-w-[280px] aspect-square rounded-3xl border-2 border-good/80 shadow-[0_0_0_100vmax_rgba(0,0,0,.55)]" />
          </div>
          <div className="absolute bottom-10 inset-x-0 text-center text-white/70 text-[13px] px-8">
            Point your camera at the wallet&apos;s QR code
          </div>
        </div>
      )}

      {(supported === "no" || error) && (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-8 gap-3">
          <span className="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center text-white/70"><Icon name="scan" size={26} /></span>
          <p className="text-white/70 text-[14px] max-w-[300px]">
            {error ?? "Your browser can't open the camera scanner. Copy the wallet address and paste it into the field instead."}
          </p>
          <button onClick={onClose} className="mt-2 bg-good text-ink h-11 px-6 rounded-xl font-grotesk font-semibold text-[14px]">Paste address instead</button>
        </div>
      )}
    </div>
  );
}
