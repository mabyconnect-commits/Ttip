"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { apiGet, apiPost } from "@/lib/client";
import { GradientButton } from "@/components/ui";
import { Field } from "@/components/Field";

const FIATS = [
  { code: "NGN", flag: "🇳🇬", label: "Naira" },
  { code: "GHS", flag: "🇬🇭", label: "Cedi" },
  { code: "KES", flag: "🇰🇪", label: "Shilling" },
  { code: "ZAR", flag: "🇿🇦", label: "Rand" },
];

interface UsernameCheck {
  username: string;
  valid: boolean;
  available: boolean;
  reason?: string;
  suggestions: string[];
}

export const dynamic = "force-dynamic";

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="app-shell" />}>
      <SignupInner />
    </Suspense>
  );
}

function SignupInner() {
  const params = useSearchParams();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fiat, setFiat] = useState("NGN");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  // Live username check. The handle is the user's tip link and how people Ttip
  // them, so they get to see it's free while typing instead of being rejected
  // after filling in the whole form.
  const [check, setCheck] = useState<UsernameCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const u = username.trim();
    setCheck(null);
    if (u.length < 3) return;
    const mine = ++seq.current;
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const r = await apiGet<UsernameCheck>(`/api/auth/username?u=${encodeURIComponent(u)}`);
        // Ignore a slow reply for a name they've already typed past.
        if (seq.current === mine) setCheck(r);
      } catch {
        if (seq.current === mine) setCheck(null);
      } finally {
        if (seq.current === mine) setChecking(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [username]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      await apiPost("/api/auth/signup", {
        name,
        username,
        email,
        password,
        defaultFiat: fiat,
        referralCode: params.get("ref") ?? undefined,
      });
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

      <div className="flex-1 flex flex-col justify-center py-6">
        <h1 className="font-grotesk font-bold text-[30px] tracking-[-1px] mb-1">Create your account</h1>
        <p className="text-white/50 text-sm mb-6">Free to join. Buy, sell and cash out in seconds.</p>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="Full name" value={name} onChange={setName} placeholder="Kola Adeyemi" autoFocus />
          <div>
            <Field
              label="Username"
              value={username}
              onChange={(v) => setUsername(v.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase())}
              placeholder="kola"
              hint={username.length >= 3 ? `Your tip link: ttip.site/u/${username}` : "Your tip link will be ttip.site/u/username"}
            />
            {username.length >= 3 && (
              <div className="ml-1 mt-1.5 text-[12px]">
                {checking && <span className="text-white/40">Checking…</span>}
                {!checking && check?.available && (
                  <span className="text-good">@{check.username} is available</span>
                )}
                {!checking && check && !check.available && (
                  <>
                    <span className="text-bad">{check.reason}</span>
                    {check.suggestions.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {check.suggestions.map((sug) => (
                          <button
                            key={sug}
                            type="button"
                            onClick={() => setUsername(sug)}
                            className="rounded-full border border-white/15 px-3 py-1 text-[12px] text-white/75 active:scale-95"
                          >
                            @{sug}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          <Field label="Email" value={email} onChange={setEmail} placeholder="you@email.com" type="email" />
          <Field label="Password" value={password} onChange={setPassword} placeholder="At least 8 characters" type="password" />

          <div>
            <span className="text-[12px] text-white/50 font-medium ml-1">Cash out to</span>
            <div className="mt-1.5 grid grid-cols-4 gap-2">
              {FIATS.map((f) => (
                <button
                  key={f.code}
                  type="button"
                  onClick={() => setFiat(f.code)}
                  className={`h-[52px] rounded-2xl border flex flex-col items-center justify-center gap-0.5 transition ${
                    fiat === f.code ? "border-brand-cyan bg-brand-cyan/10" : "border-white/10 bg-surface"
                  }`}
                >
                  <span className="text-lg leading-none">{f.flag}</span>
                  <span className="text-[10px] text-white/60">{f.code}</span>
                </button>
              ))}
            </div>
          </div>

          {err && <div className="text-bad text-[13px] px-1">{err}</div>}
          <GradientButton type="submit" loading={loading} disabled={check ? !check.available : false} className="mt-2">
            Create account
          </GradientButton>
          <p className="text-center text-white/40 text-[11.5px] leading-[1.5] mt-1 px-2">
            By creating an account you agree to our{" "}
            <Link href="/terms" className="text-white/60 underline">Terms</Link> and{" "}
            <Link href="/privacy" className="text-white/60 underline">Privacy Policy</Link>.
          </p>
        </form>
      </div>

      <p className="text-center text-white/50 text-sm pb-8">
        Already have an account?{" "}
        <Link href="/login" className="text-brand-cyan font-medium">
          Sign in
        </Link>
      </p>
    </div>
  );
}
