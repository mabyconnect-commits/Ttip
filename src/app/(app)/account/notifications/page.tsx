"use client";

import { useEffect, useState } from "react";
import { BackHeader } from "@/components/ui";
import { useApp } from "@/context/AppContext";
import { Icon } from "@/components/Icon";
import { pushState, enablePush, disablePush, pushBlockedReason, type PushState } from "@/lib/push-client";

const STORE_KEY = "ttip_notif_prefs";

const GROUPS = [
  {
    title: "Money",
    items: [
      { key: "tips", label: "Tips received", sub: "When someone Ttips you", on: true },
      { key: "payouts", label: "Payouts & swaps", sub: "Transfers and swap settlements", on: true },
      { key: "deposits", label: "Deposits", sub: "Incoming crypto & bank funding", on: true },
    ],
  },
  {
    title: "Social",
    items: [
      { key: "streaks", label: "Streaks & rewards", sub: "Streak reminders and points", on: true },
      { key: "league", label: "Ttip League", sub: "Weekly leaderboard updates", on: false },
      { key: "friends", label: "Friend activity", sub: "When friends join or tip", on: false },
    ],
  },
  {
    title: "Other",
    items: [
      { key: "promos", label: "Promos & offers", sub: "Occasional product news", on: false },
      { key: "security", label: "Security alerts", sub: "Sign-ins and PIN changes", on: true },
    ],
  },
];

export default function NotificationsPage() {
  const { toast } = useApp();
  const defaults = Object.fromEntries(GROUPS.flatMap((g) => g.items.map((i) => [i.key, i.on])));
  const [state, setState] = useState<Record<string, boolean>>(defaults);

  /**
   * The switch that actually reaches the phone.
   *
   * Everything below it is a preference stored on the device; this one asks the
   * browser for permission and registers with the push service. Without it the
   * rest are settings for messages that never arrive, which is why it sits at
   * the top and says what it is.
   */
  const [push, setPush] = useState<PushState>("off");
  const [pushBusy, setPushBusy] = useState(false);
  useEffect(() => {
    pushState().then(setPush);
  }, []);

  async function togglePush() {
    if (pushBusy) return;
    setPushBusy(true);
    if (push === "on") {
      await disablePush();
      setPush("off");
      toast("Notifications off", "info");
    } else {
      const res = await enablePush();
      setPush(await pushState());
      if (res.ok) toast("Notifications on", "good");
      else if (res.error) toast(res.error, "bad");
    }
    setPushBusy(false);
  }

  // Load saved preferences on mount.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORE_KEY);
      if (saved) setState({ ...defaults, ...JSON.parse(saved) });
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(key: string) {
    setState((s) => {
      const next = { ...s, [key]: !s[key] };
      try { localStorage.setItem(STORE_KEY, JSON.stringify(next)); } catch {}
      toast(`${next[key] ? "On" : "Off"} · saved`, next[key] ? "good" : "info");
      return next;
    });
  }

  return (
    <div className="flex flex-col flex-1 px-[22px] min-h-0">
      <BackHeader title="Notifications" />
      <div className="flex-1 overflow-y-auto no-scrollbar pb-6">
        {/* Push itself, before the preferences it governs. */}
        <div className="mt-3 bg-surface border border-white/[.06] rounded-[18px] px-4 py-3.5">
          <div className="flex items-center gap-3">
            <span
              className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
              style={{
                background: push === "on" ? "rgba(61,245,176,.12)" : "rgb(var(--fg) / .06)",
                color: push === "on" ? "#3DF5B0" : "rgb(var(--fg) / .45)",
              }}
            >
              <Icon name="bell" size={17} />
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-[14px]">Push notifications</div>
              <div className="text-white/40 text-[11.5px] leading-[1.45]">
                {push === "on"
                  ? "This device will buzz the moment money lands."
                  : "Get told the moment money lands, without opening the app."}
              </div>
            </div>
            {push === "needs-install" || push === "unsupported" ? null : (
              <button
                onClick={togglePush}
                disabled={pushBusy}
                aria-label={push === "on" ? "Turn off push notifications" : "Turn on push notifications"}
                className="w-[46px] h-[26px] rounded-full p-0.5 transition-colors shrink-0 disabled:opacity-50"
                style={{ background: push === "on" ? "#3DF5B0" : "rgb(var(--fg) / .18)" }}
              >
                <span
                  className="block w-[22px] h-[22px] rounded-full bg-white keep-white transition-transform"
                  style={{ transform: push === "on" ? "translateX(20px)" : "translateX(0)" }}
                />
              </button>
            )}
          </div>

          {/* Said plainly rather than showing a switch that would do nothing. */}
          {(push === "needs-install" || push === "unsupported" || push === "denied") && (
            <div className="mt-2.5 text-[11.5px] text-warn leading-[1.5]">
              {push === "denied"
                ? "Notifications are blocked for this site — allow them in your browser settings, then come back."
                : pushBlockedReason()}
            </div>
          )}
        </div>

        {GROUPS.map((g) => (
          <div key={g.title} className="mt-4">
            <div className="text-white/45 text-[12px] font-semibold uppercase tracking-wide ml-1 mb-2">{g.title}</div>
            <div className="bg-surface border border-white/[.06] rounded-[18px] overflow-hidden">
              {g.items.map((it, i) => (
                <div key={it.key} className={`flex items-center gap-3 px-4 py-3.5 ${i > 0 ? "border-t border-white/[.05]" : ""}`}>
                  <div className="flex-1">
                    <div className="font-medium text-[14px]">{it.label}</div>
                    <div className="text-white/40 text-[11.5px]">{it.sub}</div>
                  </div>
                  <button
                    onClick={() => toggle(it.key)}
                    className="w-[46px] h-[26px] rounded-full p-0.5 transition-colors shrink-0"
                    style={{ background: state[it.key] ? "#3DF5B0" : "rgb(var(--fg) / .18)" }}
                    aria-label={it.label}
                  >
                    <span className="block w-[22px] h-[22px] rounded-full bg-white keep-white transition-transform" style={{ transform: state[it.key] ? "translateX(20px)" : "translateX(0)" }} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
