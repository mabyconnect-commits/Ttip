"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";

/**
 * Light / dark switch.
 *
 * The choice is written to <html data-theme> — the same attribute every light
 * rule in globals.css is scoped to — and remembered in localStorage. With
 * nothing stored we follow the phone's own setting, so someone whose device is
 * in light mode doesn't get a black screen on first open.
 *
 * The theme is also applied by a tiny inline script in the root layout, BEFORE
 * the page paints. Doing it here alone would show the dark UI for a frame and
 * then flash to light, which looks broken.
 */

export type Theme = "light" | "dark";

const KEY = "ttip_theme";

export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  // Keeps the phone's status/URL bar in step with the page.
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "light" ? "#F7F8FA" : "#07080D");
}

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

/** The blocking script the layout inlines. Must stay dependency-free. */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${KEY}");if(t!=="light"&&t!=="dark"){t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";}document.documentElement.setAttribute("data-theme",t);}catch(e){}})();`;

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<Theme>("dark");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const initial =
      stored() ??
      ((document.documentElement.getAttribute("data-theme") as Theme | null) || "dark");
    setTheme(initial);
    setReady(true);
  }, []);

  function choose(next: Theme) {
    setTheme(next);
    applyTheme(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* private mode — the theme still applies for this session */
    }
  }

  // Render nothing until we know which way round it is, so the icon can't flip.
  if (!ready) return <span className={compact ? "w-9 h-9" : "w-[76px] h-9"} />;

  if (compact) {
    const next: Theme = theme === "dark" ? "light" : "dark";
    return (
      <button
        onClick={() => choose(next)}
        aria-label={next === "light" ? "Switch to light mode" : "Switch to dark mode"}
        className="w-9 h-9 rounded-full border border-white/10 flex items-center justify-center text-white/70 active:scale-95"
      >
        <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1 p-1 rounded-full border border-white/10 bg-white/[.04]">
      {(["light", "dark"] as Theme[]).map((t) => (
        <button
          key={t}
          onClick={() => choose(t)}
          aria-label={t === "light" ? "Light mode" : "Dark mode"}
          aria-pressed={theme === t}
          className="w-8 h-7 rounded-full flex items-center justify-center transition"
          style={
            theme === t
              ? { background: "rgba(61,245,176,.14)", color: "#3DF5B0" }
              : { color: "rgb(var(--fg) / .45)" }
          }
        >
          <Icon name={t === "light" ? "sun" : "moon"} size={15} />
        </button>
      ))}
    </div>
  );
}
