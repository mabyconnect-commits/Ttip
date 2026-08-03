"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/Icon";

const tabs: { href: string; label: string; icon: IconName; center?: boolean }[] = [
  { href: "/home", label: "Home", icon: "home" },
  { href: "/swap", label: "Swap", icon: "swap" },
  { href: "/ttip", label: "", icon: "zap", center: true },
  { href: "/feed", label: "Feed", icon: "activity" },
  { href: "/account", label: "Account", icon: "user" },
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
            className="grad-bg-135 w-[52px] h-[52px] rounded-[26px] flex items-center justify-center text-[#04121A] -mt-6 shadow-[0_10px_24px_rgba(42,200,255,.35)] active:scale-95"
            aria-label="Ttip"
          >
            <Icon name="zap" size={24} fill="#04121A" strokeWidth={1.5} />
          </button>
        ) : (
          <Link
            key={t.href}
            href={t.href}
            className="flex flex-col items-center gap-[3px] w-14"
            style={{ color: path === t.href ? "var(--link)" : "rgb(var(--fg) / .45)" }}
          >
            <Icon name={t.icon} size={22} />
            <span className="font-medium text-[10px]">{t.label}</span>
          </Link>
        ),
      )}
    </div>
  );
}
