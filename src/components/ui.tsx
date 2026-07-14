"use client";

import { useApp } from "@/context/AppContext";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Icon } from "@/components/Icon";

export function grad(g: string) {
  return `linear-gradient(${g})`;
}

export function Avatar({ gradient, initial, size = 38, ring }: { gradient: string; initial: string; size?: number; ring?: boolean }) {
  return (
    <div
      className="flex items-center justify-center font-grotesk font-bold text-[#04121A] shrink-0"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        background: grad(gradient),
        fontSize: size * 0.4,
        border: ring ? "3px solid rgba(42,200,255,.5)" : undefined,
      }}
    >
      {initial}
    </div>
  );
}

export function GradientButton({
  children,
  onClick,
  disabled,
  loading,
  className = "",
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`grad-bg w-full h-[56px] rounded-[28px] flex items-center justify-center gap-2 font-grotesk font-semibold text-[17px] text-[#04121A] shadow-glow transition active:scale-[.98] disabled:opacity-50 disabled:active:scale-100 px-4 text-center ${className}`}
    >
      {loading ? <Spinner /> : children}
    </button>
  );
}

export function OutlineButton({ children, onClick, className = "" }: { children: React.ReactNode; onClick?: () => void; className?: string }) {
  return (
    <button
      onClick={onClick}
      className={`w-full h-[56px] rounded-[28px] border border-white/15 flex items-center justify-center gap-2 font-medium text-[16px] text-white transition active:scale-[.98] px-4 ${className}`}
    >
      {children}
    </button>
  );
}

export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <span
      className="inline-block animate-spin rounded-full border-2 border-[#04121A]/30 border-t-[#04121A]"
      style={{ width: size, height: size }}
    />
  );
}

export function BackHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  const router = useRouter();
  return (
    <div className="flex items-center justify-between pt-4 pb-3">
      <button
        onClick={() => router.back()}
        className="w-9 h-9 rounded-[18px] border border-white/15 flex items-center justify-center text-white/80 active:scale-95"
        aria-label="Back"
      >
        <Icon name="back" size={18} />
      </button>
      <div className="font-grotesk font-semibold text-[17px]">{title}</div>
      <div className="min-w-[36px] flex justify-end">{right}</div>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex bg-surface border border-white/8 rounded-[18px] p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 h-[46px] rounded-[14px] font-grotesk font-semibold text-[15px] transition ${
            value === o.value ? "bg-white text-[#07080D]" : "text-white/60"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Sheet({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: React.ReactNode; title?: string }) {
  useEffect(() => {
    if (open) {
      const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
      window.addEventListener("keydown", h);
      return () => window.removeEventListener("keydown", h);
    }
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-[480px] bg-[#0B0D14] border-t border-white/10 rounded-t-[26px] p-5 pb-8 animate-sheet max-h-[85dvh] overflow-y-auto no-scrollbar"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 rounded-full bg-white/20 mx-auto mb-4" />
        {title && <div className="font-grotesk font-semibold text-[17px] mb-3">{title}</div>}
        {children}
      </div>
    </div>
  );
}

export function Toasts() {
  const { toasts } = useApp();
  return (
    <div className="fixed left-1/2 bottom-24 z-[60] -translate-x-1/2 flex flex-col items-center gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="animate-toast px-4 py-3 rounded-2xl text-[13px] font-medium shadow-lg max-w-[90vw] text-center"
          style={{
            background: t.tone === "good" ? "rgba(61,245,176,.14)" : t.tone === "bad" ? "rgba(255,122,138,.14)" : "rgba(255,255,255,.1)",
            border: `1px solid ${t.tone === "good" ? "rgba(61,245,176,.4)" : t.tone === "bad" ? "rgba(255,122,138,.4)" : "rgba(255,255,255,.15)"}`,
            color: t.tone === "good" ? "#3DF5B0" : t.tone === "bad" ? "#FF7A8A" : "#fff",
            backdropFilter: "blur(12px)",
          }}
        >
          {t.msg}
        </div>
      ))}
    </div>
  );
}

export function Card({ children, className = "", style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`bg-surface border border-white/[.07] rounded-[18px] ${className}`} style={style}>
      {children}
    </div>
  );
}
