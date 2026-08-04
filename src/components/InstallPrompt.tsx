"use client";

import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { Sheet } from "./ui";
import { installRoute, iosBrowserName, iosShareHint, type InstallRoute } from "@/lib/install";

/**
 * Registers the service worker and offers to add Ttip to the home screen.
 *
 * Android/Chrome fires `beforeinstallprompt`, which has to be captured — once
 * ignored it can't be reopened — so it's stashed and replayed on tap.
 *
 * iOS has no such event and never will: Apple doesn't let a site trigger an
 * install. The only route is the user tapping Share → Add to Home Screen
 * themselves, so on iOS the job is to show them exactly where that is. A single
 * line saying "tap Share" isn't enough — people look for the ICON, and it isn't
 * in the same place in Safari as it is in Chrome. So iOS gets a real sheet with
 * the icon drawn and the steps numbered.
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

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<PromptEvent | null>(null);
  const [route, setRoute] = useState<InstallRoute>("none");
  const [howTo, setHowTo] = useState(false);
  const [ua, setUa] = useState("");

  useEffect(() => {
    // Register the service worker. Without one Chrome will not offer to install.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* registration failing must never break the app */
      });
    }

    const env = {
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints,
      standalone: (navigator as unknown as { standalone?: boolean }).standalone,
      displayModeStandalone: window.matchMedia?.("(display-mode: standalone)").matches,
    };
    setUa(env.userAgent);

    if (dismissedRecently()) return;
    setRoute(installRoute(env, false));

    const onPrompt = (e: Event) => {
      e.preventDefault(); // stop Chrome's own mini-infobar so ours is the only ask
      setDeferred(e as PromptEvent);
      setRoute(installRoute(env, true));
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    // Once installed, stop offering.
    const onInstalled = () => setRoute("none");
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* private mode — just hide for this session */
    }
    setDeferred(null);
    setRoute("none");
    setHowTo(false);
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => null);
    setDeferred(null); // the event is single-use
    setRoute("none");
  }

  if (route === "none") return null;

  const browser = iosBrowserName(ua);
  const where = iosShareHint(ua);

  const copy =
    route === "open-in-browser"
      ? { line: "Open in Safari or Chrome to install", cta: "How" }
      : route === "ios-share"
        ? { line: "Add it to your home screen — opens like an app", cta: "How" }
        : { line: "Add it to your home screen — opens like an app", cta: "Install" };

  return (
    <>
      {/* The bar sits above the sheet, so hide it while the steps are open —
          otherwise it covers the last one, which is the one that completes it. */}
      <div
        className="fixed left-0 right-0 bottom-0 z-[60] px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pointer-events-none"
        style={{ display: howTo ? "none" : undefined }}
      >
        <div className="pointer-events-auto mx-auto max-w-[420px] rounded-2xl bg-surface2 border border-white/[.12] shadow-glow px-4 py-3 flex items-center gap-3">
          <span className="w-9 h-9 rounded-xl bg-brand-grad flex items-center justify-center shrink-0 text-ink">
            <Icon name="zap" size={18} strokeWidth={2.6} />
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-grotesk font-semibold text-[13.5px]">Install Ttip</div>
            <div className="text-white/50 text-[11.5px] leading-snug">{copy.line}</div>
          </div>
          <button
            onClick={route === "prompt" ? install : () => setHowTo(true)}
            className="shrink-0 h-9 px-4 rounded-xl bg-good text-ink font-grotesk font-semibold text-[13px] active:scale-95"
          >
            {copy.cta}
          </button>
          <button onClick={dismiss} aria-label="Dismiss" className="shrink-0 w-8 h-8 flex items-center justify-center text-white/40 active:text-white/70">
            <Icon name="x" size={16} />
          </button>
        </div>
      </div>

      <Sheet open={howTo} onClose={() => setHowTo(false)} title="Add Ttip to your home screen">
        {route === "open-in-browser" ? (
          <div className="flex flex-col gap-3">
            <p className="text-white/60 text-[13.5px] leading-[1.55]">
              You&apos;re in an in-app browser, which can&apos;t add apps to the home screen. Open
              ttip.site in {browser === "Safari" ? "Safari" : "your browser"} first — tap the ••• menu
              and choose &ldquo;Open in browser&rdquo;.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Step n={1}>
              Tap the <ShareGlyph /> Share button in <b className="text-white">{where}</b>.
            </Step>
            <Step n={2}>
              Scroll down and tap <b className="text-white">Add to Home Screen</b>.
            </Step>
            <Step n={3}>
              Tap <b className="text-white">Add</b>. Ttip appears on your home screen and opens
              full-screen, like an app.
            </Step>
            {browser !== "Safari" && (
              <p className="text-white/40 text-[11.5px] leading-[1.5] mt-1">
                On {browser} this needs iOS 16.4 or newer. If you don&apos;t see &ldquo;Add to Home
                Screen&rdquo;, open ttip.site in Safari and try there.
              </p>
            )}
          </div>
        )}
      </Sheet>
    </>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 items-start">
      <span className="w-6 h-6 rounded-full bg-white/[.08] flex items-center justify-center font-grotesk font-bold text-[12px] shrink-0 mt-0.5">
        {n}
      </span>
      <span className="text-white/70 text-[13.5px] leading-[1.55]">{children}</span>
    </div>
  );
}

/** iOS's share glyph — a box with an arrow leaving the top. It's what people look for. */
function ShareGlyph() {
  return (
    <span className="inline-flex items-center justify-center w-[22px] h-[22px] rounded-md bg-white/[.10] align-middle mx-0.5 text-brand-cyan">
      <Icon name="share" size={13} strokeWidth={2.2} />
    </span>
  );
}
