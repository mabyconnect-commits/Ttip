"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/Icon";

/**
 * Telegram bot status, with a button to connect it.
 *
 * Pointing Telegram at the app needs a POST, which can't be done from a browser
 * address bar — and the admin here is on a phone, where there's no console
 * either. So it's a button, same reason the funding audit is.
 *
 * It sets the webhook using the secret from the server's own environment, so the
 * value Telegram is given and the value the webhook checks can never disagree.
 */

interface Status {
  ready?: boolean;
  bot?: string | null;
  env?: { TELEGRAM_BOT_TOKEN: boolean; TELEGRAM_WEBHOOK_SECRET: boolean };
  expectedWebhookUrl?: string;
  telegramSees?: { url: string | null; pending: number; lastError: string | null } | null;
  /** How many Ttip accounts have connected their Telegram. */
  linkedUsers?: number;
  problems?: string[];
  error?: string;
}

export function TelegramCard() {
  const [s, setS] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/telegram", { cache: "no-store" });
      setS(r.ok ? await r.json() : { error: r.status === 404 ? "Not an admin account." : `Error ${r.status}` });
    } catch {
      setS({ error: "Couldn't reach the server." });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function connect() {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/admin/telegram", { method: "POST" });
      const d = await r.json();
      setMsg(d.ok ? `Connected. Send /start to ${s?.bot ?? "the bot"}.` : d.error || "Could not connect");
      await load();
    } catch {
      setMsg("Request failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!s || s.error) return null;

  return (
    <>
      <div className="font-grotesk font-semibold text-[14px] mt-6 mb-2">Telegram bot</div>
      <div className="rounded-2xl bg-surface border border-white/[.08] p-4">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <div className="font-grotesk font-semibold text-[13.5px]">{s.bot ?? "Not configured"}</div>
            <div className="text-white/45 text-[11.5px] truncate">
              {s.telegramSees?.url ? s.telegramSees.url : "No webhook set"}
            </div>
          </div>
          <span
            className="text-[10.5px] uppercase tracking-wide rounded-full px-2 py-[3px] shrink-0"
            style={
              s.ready
                ? { color: "#3DF5B0", background: "rgba(61,245,176,.12)" }
                : { color: "#FFC46B", background: "rgba(255,196,107,.12)" }
            }
          >
            {s.ready ? "live" : "not live"}
          </span>
        </div>

        <div className="flex gap-3 mt-3 text-[11.5px] text-white/50">
          <span>Token {s.env?.TELEGRAM_BOT_TOKEN ? "✓" : "✗"}</span>
          <span>Secret {s.env?.TELEGRAM_WEBHOOK_SECRET ? "✓" : "✗"}</span>
          {typeof s.telegramSees?.pending === "number" && s.telegramSees.pending > 0 && (
            <span className="text-warn">{s.telegramSees.pending} queued</span>
          )}
          {/* A bot that replies but that nobody has linked is only half-working,
              and Telegram's own diagnostics can't show you that. */}
          <span className={s.linkedUsers ? "text-good" : undefined}>
            {(s.linkedUsers ?? 0).toLocaleString("en-US")} linked
          </span>
        </div>

        {s.problems?.length ? (
          <div className="mt-3 flex flex-col gap-1.5">
            {s.problems.map((p, i) => (
              <div key={i} className="flex gap-2 text-[12px] text-white/65 leading-[1.45]">
                <Icon name="flag" size={13} className="text-warn mt-0.5 shrink-0" />
                <span>{p}</span>
              </div>
            ))}
          </div>
        ) : null}

        {msg && <div className="text-[12px] text-good mt-2">{msg}</div>}

        <button
          onClick={connect}
          disabled={busy || !s.env?.TELEGRAM_BOT_TOKEN}
          className="mt-3 w-full h-[44px] rounded-xl bg-good text-ink font-grotesk font-semibold text-[13px] disabled:opacity-40 active:scale-[.98]"
        >
          {busy ? "Connecting…" : s.ready ? "Reconnect webhook" : "Connect bot"}
        </button>
      </div>
    </>
  );
}
