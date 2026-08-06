"use client";

import { useCallback, useEffect, useState } from "react";
import { BackHeader, GradientButton } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { useApp } from "@/context/AppContext";

/**
 * Sending money with no data.
 *
 * The screen where a phone number is bound to the account and the code sheet is
 * handed over. Both halves matter and neither is decoration:
 *
 *   - the number is verified by a code we text to it, so a spoofed sender id
 *     can't reach anyone's money;
 *   - the sheet is shown ONCE. Nothing stores those codes, so a lost sheet is
 *     replaced and never recovered — a sheet we could recover is one somebody
 *     else could too.
 *
 * The sheet is the part users will not expect, so the page has to earn it:
 * this is the only authorisation that works with no internet at all, and the
 * reason we can never ask for a PIN by text.
 */

interface Status {
  enabled?: boolean;
  phone?: string | null;
  pending?: string | null;
  codesLeft?: number;
  nextIndex?: number | null;
  maxTransfer?: number;
  dailyCap?: number;
  error?: string;
}

const money = (n: number) => "₦" + n.toLocaleString("en-US");

export default function SmsPage() {
  const { toast } = useApp();
  const [s, setS] = useState<Status | null>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sheet, setSheet] = useState<{ index: number; code: string }[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/sms/link", { cache: "no-store" });
      const j = await r.json();
      setS(r.ok ? j : { error: j.error ?? `Error ${r.status}` });
    } catch {
      setS({ error: "Couldn't reach the server." });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const r = await fetch("/api/sms/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) {
        toast(j.error ?? "That didn't work.", "bad");
        return null;
      }
      await load();
      return j;
    } catch {
      toast("Request failed.", "bad");
      return null;
    } finally {
      setBusy(false);
    }
  }

  const linked = !!s?.phone;

  return (
    <div className="flex flex-col flex-1 px-[22px] min-h-0">
      <BackHeader title="Send by text" />
      <div className="flex-1 overflow-y-auto no-scrollbar pb-8">
        <p className="text-white/55 text-[13.5px] leading-[1.55] mt-1">
          Pay people you&apos;ve saved with a text message — no internet, no app, any phone. Text{" "}
          <b className="text-white">SEND 2000 MAMA</b>, then reply with the code we ask for.
        </p>

        {s?.enabled === false && (
          <div className="mt-4 rounded-2xl bg-surface border border-warn/25 p-4 text-[13px] text-white/70">
            Texting isn&apos;t switched on for this deployment yet.
          </div>
        )}

        {/* The sheet. Shown once, so it dominates the screen while it's here. */}
        {sheet && (
          <div className="mt-4 rounded-2xl bg-surface border border-good/30 p-4">
            <div className="font-grotesk font-bold text-[15px]">Your codes — save these now</div>
            <p className="text-white/55 text-[12px] mt-1 leading-[1.5]">
              Screenshot this, or write it down. Each code works once, and we&apos;ll ask for them in order. This is the
              only time they&apos;re shown — we don&apos;t keep a copy.
            </p>
            <div className="grid grid-cols-3 gap-2 mt-3">
              {sheet.map((c) => (
                <div key={c.index} className="rounded-xl bg-surface2 border border-white/[.08] px-2.5 py-2 text-center">
                  <div className="text-white/35 text-[10px]">#{c.index}</div>
                  <div className="font-mono text-[14px] tracking-wider">{c.code}</div>
                </div>
              ))}
            </div>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(sheet.map((c) => `#${c.index} ${c.code}`).join("\n"));
                toast("Copied", "good");
              }}
              className="w-full mt-3 rounded-2xl border border-white/12 py-3 font-grotesk font-semibold text-[13px] active:scale-[.99]"
            >
              Copy all
            </button>
            <button
              onClick={() => setSheet(null)}
              className="w-full mt-2 rounded-2xl bg-good/[.14] border border-good/30 py-3 font-grotesk font-semibold text-[13px] text-good active:scale-[.99]"
            >
              I&apos;ve saved them
            </button>
          </div>
        )}

        {!linked && !sheet && (
          <>
            <div className="mt-4 rounded-2xl bg-surface border border-white/[.08] px-4 py-3.5">
              <div className="text-white/45 text-[11.5px]">Your phone number</div>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                inputMode="tel"
                placeholder="0811 386 6493"
                className="w-full bg-transparent outline-none text-[16px] font-grotesk font-semibold mt-1"
              />
            </div>

            {s?.pending && (
              <div className="mt-2.5 rounded-2xl bg-surface border border-white/[.08] px-4 py-3.5">
                <div className="text-white/45 text-[11.5px]">Code we texted to {s.pending}</div>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  placeholder="6 digits"
                  className="w-full bg-transparent outline-none text-[16px] font-grotesk font-semibold mt-1 tracking-[.3em]"
                />
              </div>
            )}

            <div className="mt-4">
              {s?.pending ? (
                <GradientButton
                  loading={busy}
                  disabled={code.length < 4}
                  onClick={async () => {
                    const j = await post({ action: "verify", code });
                    if (j?.sheet) setSheet(j.sheet);
                  }}
                >
                  Verify and get my codes
                </GradientButton>
              ) : (
                <GradientButton
                  loading={busy}
                  disabled={phone.replace(/\D/g, "").length < 10 || s?.enabled === false}
                  onClick={() => post({ action: "start", phone })}
                >
                  Text me a code
                </GradientButton>
              )}
            </div>
          </>
        )}

        {linked && !sheet && (
          <>
            <div className="mt-4 rounded-2xl bg-surface border border-white/[.08] p-4">
              <div className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-full bg-good/[.14] flex items-center justify-center text-good shrink-0">
                  <Icon name="check" size={16} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-[13.5px]">{s?.phone}</div>
                  <div className="text-white/45 text-[11.5px]">
                    {s?.codesLeft ?? 0} codes left
                    {s?.nextIndex ? ` · next is #${s.nextIndex}` : ""}
                  </div>
                </div>
              </div>
              {(s?.codesLeft ?? 0) <= 5 && (
                <div className="text-warn text-[12px] mt-2.5 leading-snug">
                  You&apos;re running low. Get a new sheet before you&apos;re somewhere without data.
                </div>
              )}
            </div>

            <div className="mt-2.5 rounded-2xl bg-surface border border-white/[.08] p-4 text-[12.5px] text-white/55 leading-[1.55]">
              <b className="text-white/80">What you can do by text</b>
              <div className="mt-1.5">
                <b className="text-white/80">BAL</b> — your balance
                <br />
                <b className="text-white/80">LIST</b> — who you can pay
                <br />
                <b className="text-white/80">SEND 2000 MAMA</b> — pay someone saved
              </div>
              <div className="mt-2.5">
                Text goes only to people you&apos;ve already paid from the app, up to {money(s?.maxTransfer ?? 20000)} at
                a time and {money(s?.dailyCap ?? 50000)} a day. Never text anyone your transaction PIN — we will never
                ask for it by message.
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 mt-2.5">
              <button
                disabled={busy}
                onClick={async () => {
                  const j = await post({ action: "newSheet" });
                  if (j?.sheet) setSheet(j.sheet);
                }}
                className="rounded-2xl border border-white/12 py-3.5 font-grotesk font-semibold text-[13px] active:scale-[.99] disabled:opacity-50"
              >
                New codes
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  if (confirm("Unlink this number? Texting will stop working.")) post({ action: "unlink" });
                }}
                className="rounded-2xl border border-bad/30 py-3.5 font-grotesk font-semibold text-[13px] text-bad active:scale-[.99] disabled:opacity-50"
              >
                Unlink
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
