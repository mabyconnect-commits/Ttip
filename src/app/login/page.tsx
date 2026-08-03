"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { apiPost } from "@/lib/client";
import { GradientButton } from "@/components/ui";
import { Field } from "@/components/Field";

export default function LoginPage() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      await apiPost("/api/auth/login", { identifier, password });
      try { sessionStorage.setItem("ttip_unlocked", "1"); } catch {}
      // Full-page navigation so the freshly-set session cookie is sent with the
      // request for the protected route. Honor a safe internal ?next= target.
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.assign(next && next.startsWith("/") ? next : "/home");
    } catch (e: any) {
      setErr(e.message);
      setLoading(false);
    }
  }

  return (
    <div className="app-shell px-6">
      <div className="pt-8 flex items-center gap-3">
        <Image src="/ttip-logo.png" alt="Ttip" width={44} height={44} className="rounded-xl" />
        <span className="font-grotesk font-bold text-xl">Ttip</span>
      </div>

      <div className="flex-1 flex flex-col justify-center">
        <h1 className="font-grotesk font-bold text-[30px] tracking-[-1px] mb-1">Welcome back</h1>
        <p className="text-white/50 text-sm mb-7">Sign in to move money and tip your crew.</p>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="Email or @username" value={identifier} onChange={setIdentifier} placeholder="you@example.com" autoFocus />
          <Field label="Password" value={password} onChange={setPassword} placeholder="••••••••" type="password" />
          {err && <div className="text-bad text-[13px] px-1">{err}</div>}
          <GradientButton type="submit" loading={loading} className="mt-2">
            Sign in
          </GradientButton>
        </form>

        <Link href="/forgot" className="block text-center text-white/45 text-[13px] mt-4 active:text-white/70">
          Forgot your password?
        </Link>
      </div>

      <p className="text-center text-white/50 text-sm pb-8">
        New here?{" "}
        <Link href="/signup" className="text-brand-cyan font-medium">
          Create an account
        </Link>
      </p>
    </div>
  );
}
