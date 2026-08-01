"use client";

import { useApp } from "@/context/AppContext";
import { BackHeader } from "@/components/ui";
import { Icon } from "@/components/Icon";

export default function SupportPage() {
  const { toast } = useApp();
  const channels = [
    { icon: "💬", label: "Live chat", sub: "Typical reply in a few minutes", action: () => toast("Live chat coming soon — email us for now", "info") },
    { icon: "✉️", label: "Email us", sub: "support@ttip.money", href: "mailto:support@ttip.money" },
    { icon: "📱", label: "WhatsApp", sub: "Chat on WhatsApp", href: "https://wa.me/2348000000000?text=Hi%20Ttip%20support" },
    { icon: "🐦", label: "X / Twitter", sub: "@ttipmoney", href: "https://x.com/ttipmoney" },
  ];
  const faqs = [
    { q: "How long do bank payouts take?", a: "Most payouts settle in seconds. Bank downtime can add a few minutes." },
    { q: "Are my swaps free?", a: "Your first 3 swaps each day are free. After that a small 0.5% fee applies." },
    { q: "How do I raise my limits?", a: "Verify your identity under Account → KYC to move to Tier 2." },
  ];

  return (
    <div className="flex flex-col flex-1 px-[22px] min-h-0">
      <BackHeader title="Support" />
      <div className="flex-1 overflow-y-auto no-scrollbar pb-6">
        <div className="flex flex-col items-center text-center py-4">
          <div className="w-16 h-16 rounded-full bg-surface2 flex items-center justify-center text-white/80"><Icon name="headset" size={30} /></div>
          <div className="font-grotesk font-bold text-[19px] mt-3">How can we help?</div>
          <p className="text-white/50 text-[13px] mt-1">We&apos;re here 24/7. Pick a channel below.</p>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {channels.map((c) =>
            c.href ? (
              <a key={c.label} href={c.href} target={c.href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" className="bg-surface border border-white/[.06] rounded-2xl p-4 active:scale-[.98]">
                <div className="text-2xl">{c.icon}</div>
                <div className="font-medium text-[13.5px] mt-2">{c.label}</div>
                <div className="text-white/40 text-[11px]">{c.sub}</div>
              </a>
            ) : (
              <button key={c.label} onClick={c.action} className="bg-surface border border-white/[.06] rounded-2xl p-4 text-left active:scale-[.98]">
                <div className="text-2xl">{c.icon}</div>
                <div className="font-medium text-[13.5px] mt-2">{c.label}</div>
                <div className="text-white/40 text-[11px]">{c.sub}</div>
              </button>
            ),
          )}
        </div>
        <div className="font-grotesk font-semibold text-[14px] mt-6 mb-2">FAQs</div>
        <div className="flex flex-col gap-2">
          {faqs.map((f) => (
            <details key={f.q} className="bg-surface border border-white/[.06] rounded-2xl px-4 py-3.5">
              <summary className="font-medium text-[13.5px] cursor-pointer list-none flex justify-between items-center">
                {f.q} <span className="text-white/30">+</span>
              </summary>
              <p className="text-white/55 text-[12.5px] mt-2 leading-[1.5]">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}
