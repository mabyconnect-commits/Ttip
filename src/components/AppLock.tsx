"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useApp } from "@/context/AppContext";
import { apiPost } from "@/lib/client";
import { PinPad } from "@/components/PinPad";
import { Icon } from "@/components/Icon";
import { deviceCanAuthenticate, signInWithPasskey } from "@/lib/passkey";

const KEY = "ttip_unlocked";
/** When the app was last put away. Used to decide whether to re-lock. */
const AWAY_KEY = "ttip_away_at";

/**
 * How long the app may sit in the background before it locks again.
 *
 * The lock used to hold for a whole browser session, which in the native shell
 * means until the app is killed — so a phone handed over, or picked up off a
 * table hours later, opened straight onto someone's balance and their Send out
 * screen. Two minutes covers the ordinary interruptions (a call, copying an
 * account number out of WhatsApp, a bank OTP) without leaving the door open.
 */
const RELOCK_AFTER_MS = 2 * 60_000;

export function unlockSession() {
  try {
    sessionStorage.setItem(KEY, "1");
    sessionStorage.removeItem(AWAY_KEY);
  } catch {}
}

export function AppLock({ children }: { children: React.ReactNode }) {
  const { state, logout, toast } = useApp();
  const hasPin = state.user.hasPin;
  const [locked, setLocked] = useState(false);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState(false);
  const [clearToken, setClearToken] = useState(0);
  const [canBiometric, setCanBiometric] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);

  useEffect(() => {
    deviceCanAuthenticate().then(setCanBiometric);
  }, []);

  /**
   * Unlock with the device instead of the PIN.
   *
   * It runs the same passkey sign-in the login screen uses, which re-mints the
   * session as well — so a lock screen sitting on an expired session comes back
   * fully signed in rather than bouncing to login a moment later.
   */
  async function unlockWithDevice() {
    setBioBusy(true);
    const res = await signInWithPasskey();
    setBioBusy(false);
    if (res.ok) {
      unlockSession();
      setLocked(false);
      return;
    }
    if (res.error) toast(res.error, "bad");
  }

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

  /**
   * Lock again when the app comes back from being away.
   *
   * `visibilitychange` is what fires in both places this has to work: the
   * native shell backgrounding, and a browser tab being switched away from.
   * The timestamp is written on the way out rather than a timer being run,
   * because a backgrounded app gets no timers.
   */
  useEffect(() => {
    if (!hasPin) return;

    const onHidden = () => {
      try {
        sessionStorage.setItem(AWAY_KEY, String(Date.now()));
      } catch {}
    };
    const onVisible = () => {
      let away = 0;
      try {
        away = Number(sessionStorage.getItem(AWAY_KEY) ?? 0);
      } catch {}
      if (away && Date.now() - away >= RELOCK_AFTER_MS) {
        try {
          sessionStorage.removeItem(KEY);
          sessionStorage.removeItem(AWAY_KEY);
        } catch {}
        setLocked(true);
      }
    };

    const onChange = () => (document.visibilityState === "hidden" ? onHidden() : onVisible());
    document.addEventListener("visibilitychange", onChange);
    // Safari on iOS fires pagehide where other browsers fire visibilitychange.
    window.addEventListener("pagehide", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", onChange);
      window.removeEventListener("pagehide", onHidden);
    };
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

        {/* The same device that can sign you in can open the lock. Offered only
            once a passkey exists, so it can never be a dead button. */}
        {canBiometric && (
          <button
            onClick={unlockWithDevice}
            disabled={bioBusy}
            className="flex items-center gap-2 text-[13.5px] font-semibold text-white/80 border border-white/12 rounded-full px-4 py-2 active:scale-95 disabled:opacity-50"
          >
            <Icon name="shield" size={15} />
            {bioBusy ? "Waiting for your device…" : "Unlock with Face ID / fingerprint"}
          </button>
        )}

        <button onClick={logout} className="text-brand-cyan font-semibold text-[13.5px] mt-2">Forgot PIN? Log out & sign in</button>
      </div>
    </div>
  );
}
