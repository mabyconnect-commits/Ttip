"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const tabs = [
  { href: "/home", label: "Home", icon: "⌂" },
  { href: "/swap", label: "Swap", icon: "⇄" },
  { href: "/ttip", label: "", icon: "⚡", center: true },
  { href: "/feed", label: "Feed", icon: "◎" },
  { href: "/card", label: "Card", icon: "💳" },
];

export function TabBar() {
  const path = usePathname();
  const router = useRouter();
  return (
    <div className="sticky bottom-0 z-30 flex justify-around items-center px-[18px] pt-[10px] pb-3 border-t border-white/[.07] bg-[#0A0C12]/95 backdrop-blur">
      {tabs.map((t) =>
        t.center ? (
          <button
            key={t.href}
            onClick={() => router.push(t.href)}
            className="grad-bg-135 w-[52px] h-[52px] rounded-[26px] flex items-center justify-center text-[22px] text-[#04121A] -mt-6 shadow-[0_10px_24px_rgba(42,200,255,.35)] active:scale-95"
            aria-label="Ttip"
          >
            {t.icon}
          </button>
        ) : (
          <Link
            key={t.href}
            href={t.href}
            className="flex flex-col items-center gap-[3px]"
            style={{ color: path === t.href ? "#2AC8FF" : "rgba(255,255,255,.4)" }}
          >
            <span className="text-[19px]">{t.icon}</span>
            <span className="font-medium text-[10px]">{t.label}</span>
          </Link>
        ),
      )}
    </div>
  );
}
