"use client";

import { useEffect, useState } from "react";
import { BackHeader } from "@/components/ui";
import { useApp } from "@/context/AppContext";

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
                    style={{ background: state[it.key] ? "#3DF5B0" : "rgba(255,255,255,.14)" }}
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
