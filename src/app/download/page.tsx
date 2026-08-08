"use client";

import { useEffect, useState } from "react";

/**
 * Public "get the app" landing page — one link to share (ttip.site/download).
 *
 * Three ways onto a phone, in the order most people can use them:
 *   1. Install the web app (PWA) — works this second on Android & iPhone.
 *   2. Download the APK — a real Android install, no Play Store needed.
 *   3. Play Store — when it's live.
 *
 * The APK URL is configurable: set NEXT_PUBLIC_APK_URL to wherever the file is
 * hosted, or drop the built app-release.apk into /public as ttip.apk (the default).
 */

const APK_URL = process.env.NEXT_PUBLIC_APK_URL || "/ttip.apk";

interface BIPEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function DownloadPage() {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [isIos, setIsIos] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent || "";
    const iOS = /iPhone|iPod|iPad/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
    setIsIos(iOS);
    setInstalled(
      window.matchMedia?.("(display-mode: standalone)").matches ||
        (navigator as unknown as { standalone?: boolean }).standalone === true,
    );

    const onBIP = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BIPEvent);
    };
    window.addEventListener("beforeinstallprompt", onBIP);
    window.addEventListener("appinstalled", () => setInstalled(true));
    return () => window.removeEventListener("beforeinstallprompt", onBIP);
  }, []);

  async function installWebApp() {
    if (deferred) {
      await deferred.prompt();
      await deferred.userChoice;
      setDeferred(null);
    }
  }

  return (
    <div className="min-h-[100dvh] bg-[#07080D] text-white flex flex-col items-center px-6 py-10">
      <div className="w-full max-w-[420px] flex flex-col items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/ttip-logo.png" alt="Ttip" width={56} height={56} className="rounded-2xl" />
        <h1 className="font-grotesk font-bold text-[26px] mt-4 tracking-[-0.5px] text-center">Get the Ttip app</h1>
        <p className="text-white/55 text-[14px] mt-2 text-center leading-relaxed">
          Crypto in, cash out, tip anyone — on your home screen.
        </p>

        {installed ? (
          <div className="mt-8 w-full rounded-2xl bg-[#101219] border border-good/25 p-5 text-center">
            <div className="text-good font-grotesk font-semibold text-[15px]">You&apos;re already on the app ✓</div>
            <a href="/home" className="inline-block mt-3 text-brand-cyan font-semibold text-[14px]">Open Ttip →</a>
          </div>
        ) : (
          <div className="mt-8 w-full flex flex-col gap-3.5">
            {/* 1. Download APK (Android) */}
            <a
              href={APK_URL}
              className="rounded-2xl bg-good text-[#07080D] px-5 py-4 flex items-center gap-3 active:scale-[.99] transition"
            >
              <span className="text-2xl">🤖</span>
              <span className="flex-1">
                <span className="block font-grotesk font-bold text-[15px]">Download for Android</span>
                <span className="block text-[12px] opacity-70">Direct install (APK) · Android 7+</span>
              </span>
              <span className="text-xl">↓</span>
            </a>

            {/* 2. Install web app (PWA) */}
            {!isIos && deferred ? (
              <button
                onClick={installWebApp}
                className="rounded-2xl bg-[#101219] border border-white/12 px-5 py-4 flex items-center gap-3 text-left active:scale-[.99] transition"
              >
                <span className="text-2xl">⚡</span>
                <span className="flex-1">
                  <span className="block font-grotesk font-bold text-[15px]">Install the web app</span>
                  <span className="block text-[12px] text-white/45">One tap · no download · updates itself</span>
                </span>
                <span className="text-white/40 text-xl">＋</span>
              </button>
            ) : (
              <div className="rounded-2xl bg-[#101219] border border-white/12 px-5 py-4">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{isIos ? "" : "⚡"}</span>
                  <span className="flex-1">
                    <span className="block font-grotesk font-bold text-[15px]">
                      {isIos ? "Add to Home Screen (iPhone)" : "Install the web app"}
                    </span>
                    <span className="block text-[12px] text-white/45">
                      {isIos ? "Tap Share, then “Add to Home Screen”" : "Open ttip.site in Chrome, then tap Install"}
                    </span>
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Play Store — coming soon */}
        <div className="mt-4 text-center text-white/35 text-[12.5px]">Google Play — coming soon</div>

        {/* How to install the APK */}
        <div className="mt-9 w-full rounded-2xl bg-[#0C0E15] border border-white/[.06] p-5">
          <div className="font-grotesk font-semibold text-[13.5px] mb-2.5">Installing the APK</div>
          <ol className="text-white/55 text-[12.5px] leading-relaxed list-decimal pl-4 space-y-1.5">
            <li>Tap <b className="text-white/80">Download for Android</b> above.</li>
            <li>Open the downloaded <b className="text-white/80">.apk</b> file.</li>
            <li>If asked, allow <b className="text-white/80">“install from this source”</b> — then tap Install.</li>
            <li>Open Ttip from your home screen.</li>
          </ol>
          <div className="text-white/35 text-[11.5px] mt-3">
            Installing an APK is safe — it&apos;s the same app we submit to Google Play, just delivered directly.
          </div>
        </div>

        <a href="/home" className="mt-8 text-white/45 text-[13px] active:text-white/80">Continue in browser instead</a>
      </div>
    </div>
  );
}
