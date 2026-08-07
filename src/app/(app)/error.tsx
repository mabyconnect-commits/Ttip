"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Graceful in-app error screen.
 *
 * Without this, a client-side render crash shows Next.js's raw "Application
 * error: a client-side exception has occurred" white screen. On a money app
 * that is dangerous: it most often happens right after an action has already
 * hit the server (e.g. a withdrawal that succeeded, then the receipt failed to
 * render), and a blank crash reads as "it didn't work" — so the user tries
 * again. Every transfer carries an idempotency key so a retry can't double-send,
 * but the safer message is still: your money is fine, check Activity, don't
 * assume it failed.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();

  useEffect(() => {
    // Surface it so it shows in the logs with its digest, for diagnosis.
    console.error("[app] client render error", error?.message, error?.digest, error);
  }, [error]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 text-center gap-5 min-h-[70vh]">
      <div className="w-14 h-14 rounded-full bg-warn/[.12] flex items-center justify-center text-warn text-2xl">!</div>
      <div>
        <div className="font-grotesk font-bold text-[18px]">Something went wrong on screen</div>
        <div className="text-white/55 text-[13.5px] mt-2 leading-relaxed max-w-[320px]">
          This is a display error, not necessarily a failed action. If you just sent money or made a transfer,
          <b className="text-white/80"> it may already have gone through</b> — check your Activity before trying again,
          and don&apos;t resend.
        </div>
      </div>

      <div className="flex flex-col gap-2.5 w-full max-w-[300px] mt-1">
        <button
          onClick={() => reset()}
          className="h-12 rounded-2xl bg-good text-ink font-grotesk font-semibold text-[14px] active:scale-[.98]"
        >
          Try again
        </button>
        <button
          onClick={() => router.push("/account/transactions")}
          className="h-12 rounded-2xl border border-white/14 font-grotesk font-semibold text-[14px] text-white/80 active:scale-[.98]"
        >
          View my Activity
        </button>
        <button
          onClick={() => router.push("/home")}
          className="h-11 font-grotesk font-medium text-[13px] text-white/50 active:text-white/80"
        >
          Back to home
        </button>
      </div>
    </div>
  );
}
