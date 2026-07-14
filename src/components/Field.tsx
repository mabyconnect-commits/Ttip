"use client";

export function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  autoFocus,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  autoFocus?: boolean;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-[12px] text-white/50 font-medium ml-1">{label}</span>
      <input
        className="mt-1.5 w-full h-[52px] rounded-2xl bg-surface border border-white/10 px-4 text-[15px] outline-none focus:border-brand-cyan/60 transition"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={type}
        autoFocus={autoFocus}
        autoCapitalize="none"
        autoCorrect="off"
      />
      {hint && <span className="text-[11px] text-white/35 ml-1 mt-1 block">{hint}</span>}
    </label>
  );
}
