"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";

export function PinPad({
  length = 4,
  onComplete,
  onChange,
  clearToken,
  error,
}: {
  length?: number;
  onComplete: (pin: string) => void;
  onChange?: (pin: string) => void;
  clearToken?: number; // change this value to reset the input
  error?: boolean;
}) {
  const [pin, setPin] = useState("");

  useEffect(() => {
    setPin("");
  }, [clearToken]);

  function push(d: string) {
    if (pin.length >= length) return;
    const next = pin + d;
    setPin(next);
    onChange?.(next);
    if (next.length === length) onComplete(next);
  }
  function back() {
    const next = pin.slice(0, -1);
    setPin(next);
    onChange?.(next);
  }

  return (
    <div className="flex flex-col items-center gap-8 select-none">
      {/* dots */}
      <div className={`flex gap-4 ${error ? "animate-[shake_.3s]" : ""}`}>
        {Array.from({ length }).map((_, i) => (
          <span
            key={i}
            className="w-3.5 h-3.5 rounded-full transition-all"
            style={{
              background: i < pin.length ? (error ? "#FF7A8A" : "#2AC8FF") : "transparent",
              border: `2px solid ${i < pin.length ? (error ? "#FF7A8A" : "#2AC8FF") : "rgba(255,255,255,.22)"}`,
            }}
          />
        ))}
      </div>

      {/* keypad */}
      <div className="grid grid-cols-3 gap-x-10 gap-y-5">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((n) => (
          <Key key={n} onClick={() => push(n)}>{n}</Key>
        ))}
        <span />
        <Key onClick={() => push("0")}>0</Key>
        <Key onClick={back} aria-label="Delete">
          <Icon name="back" size={22} />
        </Key>
      </div>
    </div>
  );
}

function Key({ children, onClick, ...rest }: { children: React.ReactNode; onClick: () => void } & React.HTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      onClick={onClick}
      {...rest}
      className="w-16 h-16 rounded-full flex items-center justify-center font-grotesk font-semibold text-[26px] text-white active:bg-white/10 transition"
    >
      {children}
    </button>
  );
}
