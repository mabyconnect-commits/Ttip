"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useApp } from "@/context/AppContext";
import { apiPost } from "@/lib/client";
import { PinPad } from "@/components/PinPad";
import { Icon } from "@/components/Icon";

const KEY = "ttip_unlocked";

export function unlockSession() {
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {}
}

export function AppLock({ children }: { children: React.ReactNode }) {
  const { state, logout, toast } = useApp();
  const hasPin = state.user.hasPin;
  const [locked, setLocked] = useState(false);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState(false);
  const [clearToken, setClearToken] = useState(0);

  useEffect(() => {
    if (!hasPin) {
      setLocked(false);
      setReady(true);
      return;
    }
    const unlocked = (() => {
      try {
        return sessionStorage.getItem(KEY) === "1";
      } catch {
        return true;
      }
    })();
    setLocked(hasPin && !unlocked);
    setReady(true);
  }, [hasPin]);

  async function onComplete(pin: string) {
    try {
      const res = await apiPost<{ valid: boolean }>("/api/pin/verify", { pin });
      if (res.valid) {
        unlockSession();
        setLocked(false);
      } else {
        setErr(true);
        setTimeout(() => { setErr(false); setClearToken((t) => t + 1); }, 600);
        toast("Wrong PIN", "bad");
      }
    } catch {
      setErr(true);
      setTimeout(() => { setErr(false); setClearToken((t) => t + 1); }, 600);
    }
  }

  // Users without a PIN are never gated — render immediately (no SSR flash).
  if (!hasPin) return <>{children}</>;
  if (!ready) return null;
  if (!locked) return <>{children}</>;

  return (
    <div className="absolute inset-0 z-[80] flex flex-col bg-ink px-6">
      <div className="flex items-center justify-between pt-5">
        <button onClick={logout} className="text-[14px] font-semibold text-white/80">Log out</button>
        <button onClick={() => toast("Contact support from the lock screen", "info")} className="flex items-center gap-1.5 text-[14px] font-medium text-white/80 bg-white/10 rounded-full px-3.5 py-1.5">
          <Icon name="headset" size={16} /> Help
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-6">
        <Image src="/ttip-logo.png" alt="Ttip" width={64} height={64} className="rounded-2xl" />
        <div className="text-center">
          <div className="font-grotesk font-bold text-[26px]">Welcome back</div>
          <div className="text-white/50 text-[14px] mt-1">Enter your PIN</div>
        </div>
        <PinPad onComplete={onComplete} clearToken={clearToken} error={err} />
        <button onClick={logout} className="text-brand-cyan font-semibold text-[13.5px] mt-2">Forgot PIN? Log out & sign in</button>
      </div>
    </div>
  );
}
