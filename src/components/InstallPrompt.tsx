"use client";

import { useEffect, useState } from "react";
import { Icon } from "./Icon";

/**
 * Registers the service worker and offers "Install app".
 *
 * Chrome fires `beforeinstallprompt` when the app qualifies, but the event has
 * to be captured — once it's ignored the prompt can't be reopened — so it's
 * stashed and replayed when the user taps Install.
 *
 * iOS Safari has no such event and never shows an install banner, so there we
 * fall back to telling the user where the Share → Add to Home Screen option is.
 *
 * The bar hides itself when the app is already running standalone, and stays
 * hidden for a while once dismissed.
 */

interface PromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "ttip.install.dismissed";
const DISMISS_DAYS = 14;

function dismissedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(at) && Date.now() - at < DISMISS_DAYS * 864e5;
  } catch {
    return false;
  }
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS reports it here instead.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<PromptEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    // Register the service worker. Without one Chrome will not offer to install.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* registration failing must never break the app */
      });
    }

    if (isStandalone() || dismissedRecently()) return;

    const onPrompt = (e: Event) => {
      e.preventDefault(); // stop Chrome's own mini-infobar so ours is the only ask
      setDeferred(e as PromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    // iOS: no event to wait for, so show the manual hint on Safari only.
    const ua = navigator.userAgent;
    const isIos = /iPad|iPhone|iPod/.test(ua);
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    if (isIos && isSafari) setIosHint(true);

    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* private mode — just hide for this session */
    }
    setDeferred(null);
    setIosHint(false);
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => null);
    setDeferred(null); // the event is single-use
  }

  if (!deferred && !iosHint) return null;

  return (
    <div className="fixed left-0 right-0 bottom-0 z-[60] px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pointer-events-none">
      <div className="pointer-events-auto mx-auto max-w-[420px] rounded-2xl bg-surface2 border border-white/[.12] shadow-glow px-4 py-3 flex items-center gap-3">
        <span className="w-9 h-9 rounded-xl bg-brand-grad flex items-center justify-center shrink-0 text-ink">
          <Icon name="zap" size={18} strokeWidth={2.6} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-grotesk font-semibold text-[13.5px]">Install Ttip</div>
          <div className="text-white/50 text-[11.5px] leading-snug">
            {iosHint ? "Tap Share, then “Add to Home Screen”." : "Add it to your home screen — opens like an app."}
          </div>
        </div>
        {!iosHint && (
          <button
            onClick={install}
            className="shrink-0 h-9 px-4 rounded-xl bg-good text-ink font-grotesk font-semibold text-[13px] active:scale-95"
          >
            Install
          </button>
        )}
        <button onClick={dismiss} aria-label="Dismiss" className="shrink-0 w-8 h-8 flex items-center justify-center text-white/40 active:text-white/70">
          <Icon name="x" size={16} />
        </button>
      </div>
    </div>
  );
}
