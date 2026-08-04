"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/ui";
import { PinPad } from "@/components/PinPad";
import { useApp } from "@/context/AppContext";

/**
 * Asks for the transaction PIN before an irreversible transfer.
 *
 * The PIN is never stored anywhere by this component — it's handed straight to
 * the caller for the one request and forgotten. Someone with no PIN set is sent
 * to Security to create one rather than being allowed through, because a
 * withdrawal is the thing that can't be undone.
 */
export function PinPrompt({
  open,
  onClose,
  onPin,
  title = "Confirm with your PIN",
  subtitle,
  error,
  busy = false,
  above = false,
}: {
  open: boolean;
  onClose: () => void;
  /** Called with the entered PIN. Return false to signal a wrong PIN. */
  onPin: (pin: string) => void;
  title?: string;
  subtitle?: string;
  /** Set true to shake and clear — a rejected PIN. */
  error?: boolean;
  /** True while the transfer is in flight. */
  busy?: boolean;
  /** Raise above a full-screen overlay (Ada's chat panel). */
  above?: boolean;
}) {
  const { state } = useApp();
  const router = useRouter();
  const [clearToken, setClearToken] = useState(0);
  // Guards the gap between the last digit and `busy` arriving from the parent:
  // without it a fast second tap fires onPin again before the parent re-renders.
  const sending = useRef(false);

  useEffect(() => {
    if (!open) sending.current = false;
  }, [open]);

  // A rejected PIN clears the pad and re-arms it.
  useEffect(() => {
    if (error) {
      sending.current = false;
      setClearToken((t) => t + 1);
    }
  }, [error]);

  if (!state.user.hasPin) {
    return (
      <Sheet open={open} onClose={onClose} above={above} title="Set a transaction PIN">
        <p className="text-white/55 text-[13.5px] leading-[1.55]">
          Withdrawals need a PIN. It takes a minute to set, and it&apos;s what stops anyone who picks
          up your unlocked phone from emptying your account.
        </p>
        <button
          onClick={() => router.push("/account/security")}
          className="mt-4 w-full h-[50px] rounded-2xl bg-good text-ink font-grotesk font-semibold text-[14px] active:scale-[.98]"
        >
          Set my PIN
        </button>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onClose={busy ? () => {} : onClose} above={above} title={title}>
      {subtitle && <p className="text-white/55 text-[13px] mb-4 -mt-1">{subtitle}</p>}

      {busy ? (
        // Replace the pad entirely while it's in flight. Leaving it up invites
        // a second entry, and a second entry used to mean a second transfer.
        <div className="flex flex-col items-center justify-center gap-3 py-14">
          <span className="w-8 h-8 rounded-full border-2 border-white/15 border-t-good animate-spin" />
          <span className="font-grotesk font-semibold text-[14px]">Sending…</span>
          <span className="text-white/40 text-[12px]">Don&apos;t close this — it only takes a moment.</span>
        </div>
      ) : (
        <div className="py-2">
          <PinPad
            onComplete={(pin) => {
              if (sending.current) return;
              sending.current = true;
              onPin(pin);
            }}
            clearToken={clearToken}
            error={error}
          />
        </div>
      )}
    </Sheet>
  );
}
