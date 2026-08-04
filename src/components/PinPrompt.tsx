"use client";

import { useState } from "react";
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
}: {
  open: boolean;
  onClose: () => void;
  /** Called with the entered PIN. Return false to signal a wrong PIN. */
  onPin: (pin: string) => void;
  title?: string;
  subtitle?: string;
  /** Set true to shake and clear — a rejected PIN. */
  error?: boolean;
}) {
  const { state } = useApp();
  const router = useRouter();
  const [clearToken, setClearToken] = useState(0);

  if (!state.user.hasPin) {
    return (
      <Sheet open={open} onClose={onClose} title="Set a transaction PIN">
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
    <Sheet open={open} onClose={onClose} title={title}>
      {subtitle && <p className="text-white/55 text-[13px] mb-4 -mt-1">{subtitle}</p>}
      <div className="py-2">
        <PinPad
          onComplete={(pin) => {
            onPin(pin);
            // Clear either way: a rejected PIN shouldn't stay on screen.
            setTimeout(() => setClearToken((t) => t + 1), 250);
          }}
          clearToken={clearToken}
          error={error}
        />
      </div>
    </Sheet>
  );
}
