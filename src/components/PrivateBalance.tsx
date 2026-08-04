"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";

/**
 * Hiding your balance.
 *
 * Phones get handed around. Someone shows a friend a photo, a colleague looks
 * over a shoulder on a bus, a seller watches you open the app to pay them —
 * and none of that should mean showing them ₦675,840.
 *
 * The one thing that matters here is that the number must never appear, not
 * even for a frame. The balance is server-rendered, so hiding it from a React
 * effect would paint the real figure first and blank it a moment later — which
 * is precisely the glance this is meant to prevent. So the preference is
 * applied by a tiny script BEFORE the first paint (the same trick the theme
 * uses), and the masking itself is pure CSS on <html data-private> — no state,
 * no timing, nothing to lose a race with.
 *
 * The choice lives on the device, not the account: it's about who is standing
 * next to THIS phone, and it shouldn't follow you onto a shared laptop or be
 * something the server has an opinion about.
 */

const KEY = "ttip_hide_balance";
const ATTR = "data-private";

/** The blocking script the layout inlines. Must stay dependency-free. */
export const PRIVACY_INIT_SCRIPT = `(function(){try{if(localStorage.getItem("${KEY}")==="1")document.documentElement.setAttribute("${ATTR}","1");}catch(e){}})();`;

function hiddenNow(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.getAttribute(ATTR) === "1";
}

export function setBalanceHidden(hidden: boolean) {
  if (hidden) document.documentElement.setAttribute(ATTR, "1");
  else document.documentElement.removeAttribute(ATTR);
  try {
    localStorage.setItem(KEY, hidden ? "1" : "0");
  } catch {
    /* private mode — it still applies for this session */
  }
}

/**
 * An amount only its owner should see.
 *
 * Both versions are rendered and CSS picks one, so switching is instant and
 * the hidden state survives a reload with nothing to flash. When hidden, the
 * real value is `display:none` — out of the page and out of the accessibility
 * tree, not merely blurred.
 */
export function Private({
  children,
  mask = "••••",
  className = "",
}: {
  children: React.ReactNode;
  /** What stands in for the number. Match its rough width to avoid a jump. */
  mask?: string;
  className?: string;
}) {
  return (
    <span className={className}>
      <span className="private-real">{children}</span>
      <span className="private-mask" aria-hidden="true">
        {mask}
      </span>
    </span>
  );
}

/**
 * The eye. Small, next to the balance, where people already look for it.
 *
 * Renders a placeholder until mounted so the icon can't show the wrong way
 * round for a frame — the state it reflects was set before React ran.
 */
export function HideBalanceToggle({ className = "" }: { className?: string }) {
  const [hidden, setHidden] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setHidden(hiddenNow());
    setReady(true);
  }, []);

  if (!ready) return <span className="w-7 h-7" />;

  return (
    <button
      onClick={() => {
        const next = !hidden;
        setHidden(next);
        setBalanceHidden(next);
      }}
      aria-label={hidden ? "Show balance" : "Hide balance"}
      aria-pressed={hidden}
      className={`w-7 h-7 rounded-full flex items-center justify-center text-white/45 active:scale-90 transition ${className}`}
    >
      <Icon name={hidden ? "eyeOff" : "eye"} size={16} />
    </button>
  );
}
