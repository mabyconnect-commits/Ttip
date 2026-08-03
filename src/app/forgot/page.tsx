"use client";

import { useState } from "react";
import Link from "next/link";
import { apiPost } from "@/lib/client";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await apiPost("/api/auth/forgot", { email });
      // Shown whether or not the address has an account — the server doesn't
      // say, so we can't either.
      setSent(true);
    } catch (e: any) {
      setErr(e.message ?? "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-[100dvh] flex flex-col justify-center px-[26px] max-w-[440px] mx-auto">
      <h1 className="font-grotesk font-bold text-[26px] tracking-[-0.5px]">Forgot your password?</h1>

      {sent ? (
        <>
          <p className="text-white/55 text-[14px] mt-3 leading-[1.6]">
            If an account exists for <b className="text-white">{email}</b>, we&apos;ve sent a reset link. It works once
            and expires in 30 minutes.
          </p>
          <p className="text-white/40 text-[13px] mt-3 leading-[1.6]">
            Check your spam folder if it doesn&apos;t arrive in a minute.
          </p>
          <Link
            href="/login"
            className="mt-7 h-[52px] rounded-2xl bg-good text-ink flex items-center justify-center font-grotesk font-semibold text-[15px]"
          >
            Back to sign in
          </Link>
        </>
      ) : (
        <>
          <p className="text-white/55 text-[14px] mt-2 leading-[1.6]">
            Enter the email on your account and we&apos;ll send you a link to set a new password.
          </p>
          <form onSubmit={submit} className="flex flex-col mt-6">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
              className="bg-surface border border-white/[.08] rounded-2xl px-4 h-[54px] outline-none text-[15px] focus:border-brand-cyan/50"
            />
            {err && <div className="text-bad text-[13px] mt-2.5 leading-snug">{err}</div>}
            <button
              type="submit"
              disabled={busy || !email}
              className="mt-4 h-[52px] rounded-2xl bg-good text-ink font-grotesk font-semibold text-[15px] disabled:opacity-40"
            >
              {busy ? "Sending…" : "Send reset link"}
            </button>
          </form>
          <Link href="/login" className="text-white/45 text-[13.5px] mt-6 text-center">
            Back to sign in
          </Link>
        </>
      )}
    </div>
  );
}
