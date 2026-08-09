"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";

export function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  autoFocus,
  hint,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  autoFocus?: boolean;
  hint?: string;
  autoComplete?: string;
}) {
  // A password field gets a show/hide toggle so people can check what they typed
  // before committing — mistyped passwords behind dots are a common signup snag.
  const isPassword = type === "password";
  const [show, setShow] = useState(false);
  const inputType = isPassword ? (show ? "text" : "password") : type;

  return (
    <label className="block">
      <span className="text-[12px] text-white/50 font-medium ml-1">{label}</span>
      <div className="relative">
        <input
          className={`mt-1.5 w-full h-[52px] rounded-2xl bg-surface border border-white/10 ${
            isPassword ? "pl-4 pr-12" : "px-4"
          } text-[15px] outline-none focus:border-brand-cyan/60 transition`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          type={inputType}
          autoFocus={autoFocus}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete={autoComplete}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? "Hide password" : "Show password"}
            className="absolute right-1.5 top-1.5 h-[52px] w-11 flex items-center justify-center text-white/45 active:text-white/80"
          >
            <Icon name={show ? "eyeOff" : "eye"} size={19} />
          </button>
        )}
      </div>
      {hint && <span className="text-[11px] text-white/35 ml-1 mt-1 block">{hint}</span>}
    </label>
  );
}
