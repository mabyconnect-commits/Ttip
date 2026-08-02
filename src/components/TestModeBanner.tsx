"use client";

import { useApp } from "@/context/AppContext";
import { Icon } from "./Icon";

/**
 * Honest money-mode banner. When the app isn't wired to live providers, this
 * makes it unmistakable that no real money is moving — so a simulated buy or
 * withdrawal is never mistaken for the real thing.
 *
 *   demo     → "Test mode — no real money moves"
 *   disabled → "Payments are off" (the endpoints also reject, this just explains)
 *   live     → nothing (real money; stay out of the way)
 */
export function TestModeBanner() {
  const { state } = useApp();
  const mode = state.config?.payments ?? "disabled";
  if (mode === "live") return null;

  const demo = mode === "demo";
  return (
    <div
      className="flex items-center gap-2 rounded-xl px-3 py-2 mb-3 text-[12px]"
      style={{
        background: demo ? "rgba(255,200,91,.10)" : "rgba(255,122,138,.10)",
        border: `1px solid ${demo ? "rgba(255,200,91,.28)" : "rgba(255,122,138,.28)"}`,
        color: demo ? "#FFC85B" : "#FF9AA6",
      }}
    >
      <Icon name="shield" size={14} className="shrink-0" />
      <span>
        {demo
          ? "Test mode — this is a simulation, no real money moves."
          : "Payments are not live yet — real transactions are disabled."}
      </span>
    </div>
  );
}
