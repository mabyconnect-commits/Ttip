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
      // request for the protected /home route.
      window.location.assign("/home");
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
          <Field label="Email or @username" value={identifier} onChange={setIdentifier} placeholder="kola@ttip.money" autoFocus />
          <Field label="Password" value={password} onChange={setPassword} placeholder="••••••••" type="password" />
          {err && <div className="text-bad text-[13px] px-1">{err}</div>}
          <GradientButton type="submit" loading={loading} className="mt-2">
            Sign in
          </GradientButton>
        </form>

        <div className="mt-4 rounded-2xl bg-surface border border-white/[.07] p-3 text-[12px] text-white/50">
          Demo account · <b className="text-white/75">kola@ttip.money</b> / <b className="text-white/75">password123</b>
        </div>
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
