"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { apiPost } from "@/lib/client";

export const dynamic = "force-dynamic";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetInner />
    </Suspense>
  );
}

function ResetInner() {
  const token = useSearchParams().get("token") ?? "";
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  const tooShort = pw.length > 0 && pw.length < 8;
  const mismatch = confirm.length > 0 && pw !== confirm;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw !== confirm) return setErr("Both passwords must match.");
    setBusy(true);
    setErr("");
    try {
      await apiPost("/api/auth/reset", { token, password: pw });
      setDone(true);
    } catch (e: any) {
      setErr(e.message ?? "Couldn't reset your password.");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="min-h-[100dvh] flex flex-col justify-center px-[26px] max-w-[440px] mx-auto">
        <h1 className="font-grotesk font-bold text-[24px]">Link not valid</h1>
        <p className="text-white/55 text-[14px] mt-2 leading-[1.6]">
          This reset link is incomplete. Request a new one and use the most recent email.
        </p>
        <Link href="/forgot" className="mt-6 h-[52px] rounded-2xl bg-good text-ink flex items-center justify-center font-grotesk font-semibold text-[15px]">
          Request a new link
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-[100dvh] flex flex-col justify-center px-[26px] max-w-[440px] mx-auto">
        <h1 className="font-grotesk font-bold text-[24px]">Password updated</h1>
        <p className="text-white/55 text-[14px] mt-2 leading-[1.6]">
          Sign in with your new password. The reset link has now been used and won&apos;t work again.
        </p>
        <button
          onClick={() => router.push("/login")}
          className="mt-6 h-[52px] rounded-2xl bg-good text-ink font-grotesk font-semibold text-[15px]"
        >
          Sign in
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col justify-center px-[26px] max-w-[440px] mx-auto">
      <h1 className="font-grotesk font-bold text-[26px] tracking-[-0.5px]">Set a new password</h1>
      <p className="text-white/55 text-[14px] mt-2 leading-[1.6]">Use at least 8 characters.</p>
      <form onSubmit={submit} className="flex flex-col mt-6 gap-2.5">
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="New password"
          autoComplete="new-password"
          required
          className="bg-surface border border-white/[.08] rounded-2xl px-4 h-[54px] outline-none text-[15px] focus:border-brand-cyan/50"
        />
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirm new password"
          autoComplete="new-password"
          required
          className="bg-surface border border-white/[.08] rounded-2xl px-4 h-[54px] outline-none text-[15px] focus:border-brand-cyan/50"
        />
        {tooShort && <div className="text-white/45 text-[12.5px]">A bit longer — 8 characters minimum.</div>}
        {mismatch && <div className="text-bad text-[12.5px]">Both passwords must match.</div>}
        {err && <div className="text-bad text-[13px] leading-snug">{err}</div>}
        <button
          type="submit"
          disabled={busy || pw.length < 8 || pw !== confirm}
          className="mt-2 h-[52px] rounded-2xl bg-good text-ink font-grotesk font-semibold text-[15px] disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save new password"}
        </button>
      </form>
    </div>
  );
}
