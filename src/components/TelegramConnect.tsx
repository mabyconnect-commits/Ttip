"use client";

import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { useApp } from "@/context/AppContext";

/**
 * Connect this account to the Telegram bot.
 *
 * The whole flow is one tap. We mint a single-use token behind the session
 * cookie and open t.me/<bot>?start=<token>; Telegram delivers it to the webhook,
 * which binds the chat. The user never types anything into the chat — which is
 * the point, because it lets us tell them, truthfully and without exceptions,
 * that Ada will never ask for a PIN or a BVN on Telegram.
 *
 * Renders nothing when no bot token is configured, so the card can't advertise
 * a bot that doesn't exist.
 */

interface Status {
  available: boolean;
  linked: boolean;
  handle: string | null;
}

export function TelegramConnect() {
  const { toast } = useApp();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/telegram/link", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  if (!status?.available) return null;

  async function connect() {
    setBusy(true);
    try {
      const res = await fetch("/api/telegram/link", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Couldn't create the link");
      // Same tab would leave the PWA; a new one keeps the app where it was.
      window.open(data.url, "_blank", "noopener");
      toast("Opening Telegram — tap Start to finish", "good");
      // The webhook does the binding on Telegram's side, so re-read on return
      // rather than assuming it worked.
      setTimeout(() => {
        fetch("/api/telegram/link", { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .then((s) => s && setStatus(s))
          .catch(() => {});
      }, 6000);
    } catch (e: any) {
      toast(e.message ?? "Couldn't create the link", "bad");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      const res = await fetch("/api/telegram/link", { method: "DELETE" });
      if (!res.ok) throw new Error("Couldn't disconnect");
      setStatus({ ...status!, linked: false, handle: null });
      toast("Telegram disconnected", "good");
    } catch (e: any) {
      toast(e.message ?? "Couldn't disconnect", "bad");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-2xl bg-surface border border-white/[.06] p-4">
      <div className="flex items-center gap-3">
        <span
          className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
          style={{ background: "rgba(42,200,255,.10)", border: "1px solid rgba(42,200,255,.28)" }}
        >
          <Icon name="telegram" size={19} className="text-brand-cyan" />
        </span>
        <div className="flex-1">
          <div className="font-grotesk font-semibold text-[15px]">Telegram</div>
          <div className="text-white/50 text-[12px]">
            {status.linked
              ? status.handle
                ? `Connected as @${status.handle}`
                : "Connected"
              : "Ask Ada about your account from Telegram"}
          </div>
        </div>
        {status.linked && <Icon name="check" size={17} className="text-good" strokeWidth={2.6} />}
      </div>

      {status.linked ? (
        <>
          <p className="text-white/40 text-[11.5px] leading-[1.5] mt-3">
            Ada can see your balance, limits and transfers in that chat. She can&apos;t move money from
            Telegram — that stays here, on purpose.
          </p>
          <button
            onClick={disconnect}
            disabled={busy}
            className="w-full mt-3 h-10 rounded-xl border border-bad/30 bg-bad/10 text-bad text-[13px] font-medium active:scale-[.99] disabled:opacity-50"
          >
            Disconnect
          </button>
        </>
      ) : (
        <>
          <p className="text-white/40 text-[11.5px] leading-[1.5] mt-3">
            One tap connects this chat so Ada knows who you are. You&apos;ll never type your PIN,
            password or BVN into Telegram — she will never ask.
          </p>
          <button
            onClick={connect}
            disabled={busy}
            className="w-full mt-3 h-10 rounded-xl bg-brand-cyan/15 border border-brand-cyan/40 text-brand-cyan text-[13px] font-semibold active:scale-[.99] disabled:opacity-50"
          >
            {busy ? "Opening…" : "Connect Telegram"}
          </button>
        </>
      )}
    </div>
  );
}
