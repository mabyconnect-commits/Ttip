"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { COMPANY } from "@/lib/company";
import { PinPrompt } from "@/components/PinPrompt";
import { useApp } from "@/context/AppContext";
import {
  listen,
  speechSupported,
  speechErrorMessage,
  record,
  recordingSupported,
  transcribeBlob,
  type Listener,
  type Recording,
} from "@/lib/speech-input";

/**
 * Ada — the floating in-app assistant.
 *
 * Always rendered. It used to hide itself unless the server reported an API key
 * was configured, which meant that on a deploy without one there was no support
 * chat at all — worse than a plain one. The server now answers from built-in
 * knowledge when the model isn't available, so the button is always real.
 *
 * Mounted once in the app shell, so it's reachable from every screen without
 * each page knowing about it. Other screens open it by dispatching
 * `window.dispatchEvent(new Event(ASSISTANT_OPEN))` — that's how the "Live chat"
 * tile on the support page works, with no prop drilling.
 */

export const ASSISTANT_OPEN = "ttip:assistant-open";

const STORE_KEY = "ttip_ada_thread";
const NAME = "Ada";

/** A bill Ada has prepared. Not bought until the user enters their PIN. */
interface BillDraft {
  kind: "bill";
  category: "airtime" | "data";
  provider: string;
  billerCode: string;
  itemCode: string;
  planName: string;
  phone: string;
  amountNgn: number;
  fiat: string;
}

/** A transfer Ada has prepared. It is NOT sent until the user enters their PIN. */
interface TransferDraft {
  kind: "transfer";
  amount: number;
  fiat: string;
  beneficiaryName: string;
  accountNumber: string;
  bankName: string | null;
  /** The name the BANK returned. Null when it couldn't be confirmed. */
  resolvedName?: string | null;
}

interface Msg {
  role: "user" | "assistant";
  content: string;
  /** Set when Ada asked for a human — renders the hand-over button. */
  escalate?: boolean;
  /** A prepared transfer awaiting confirmation. */
  draft?: TransferDraft | BillDraft;
  /** Set once the draft has been sent, so it can't be sent twice. */
  sent?: boolean;
}

const STARTERS = [
  "How do I cash out to my bank?",
  "Why is my transfer still pending?",
  "How do I raise my limits?",
  "What fees does Ttip charge?",
];

export function Assistant() {
  const { action, toast } = useApp();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<TransferDraft | BillDraft | null>(null);
  const [pinError, setPinError] = useState(false);
  const [sending, setSending] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Photograph an account instead of typing ten digits in a market.
  const fileRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);

  // Speak instead of typing. Held in a ref so the button can stop it.
  const [listening, setListening] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);
  const listener = useRef<Listener | null>(null);
  const recorder = useRef<Recording | null>(null);
  const heard = useRef("");
  const [transcribing, setTranscribing] = useState(false);

  // Either route is enough to offer the button.
  useEffect(() => setCanSpeak(speechSupported() || recordingSupported()), []);

  // Restore the thread so closing the panel mid-conversation doesn't lose it.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORE_KEY);
      if (saved) setMsgs(JSON.parse(saved));
    } catch {}
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(msgs.slice(-20)));
    } catch {}
  }, [msgs]);

  useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener(ASSISTANT_OPEN, h);
    return () => window.removeEventListener(ASSISTANT_OPEN, h);
  }, []);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]);

  // Keep the newest message in view as it streams in.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, open]);

  /**
   * A photo of an account, turned into a payment to confirm.
   *
   * The reply and the draft card are pushed into the thread exactly as if Ada
   * had answered a typed message, so there's one confirmation flow and one PIN
   * step no matter how the details arrived.
   */
  const scan = useCallback(
    async (file: File) => {
      if (scanning || busy) return;
      setScanning(true);
      const caption = input.trim();
      setMsgs((prev) => [
        ...prev,
        { role: "user", content: caption ? `📷 ${caption}` : "📷 Photo of an account" },
        { role: "assistant", content: "" },
      ]);
      setInput("");

      try {
        const dataUrl: string = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = () => reject(new Error("Couldn't read that file"));
          r.readAsDataURL(file);
        });

        const res = await fetch("/api/assistant/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: dataUrl, mimeType: file.type, caption }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? "I couldn't read that image.");

        setMsgs((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: "assistant", content: data.text, draft: data.draft ?? undefined };
          return next;
        });
      } catch (e: any) {
        setMsgs((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            role: "assistant",
            content: e?.message ?? "I couldn't read that image. Try a sharper photo, or type the details.",
          };
          return next;
        });
      } finally {
        setScanning(false);
      }
    },
    [busy, input, scanning],
  );

  /**
   * Hold-free voice: tap to start, tap to stop.
   *
   * What was heard lands in the input box rather than being sent straight off.
   * A misheard amount has to be visible and editable BEFORE the PIN, not
   * discovered after the money has gone.
   */
  const toggleListening = useCallback(async () => {
    // ---- stop ----
    if (listening) {
      listener.current?.stop();
      listener.current = null;
      const rec = recorder.current;
      recorder.current = null;
      setListening(false);

      // Give the recogniser a moment to deliver its last result before
      // deciding it produced nothing.
      await new Promise((r) => setTimeout(r, 350));
      const blob = rec ? await rec.stop() : null;

      if (heard.current.trim()) {
        inputRef.current?.focus();
        return; // the browser heard it; nothing to upload
      }
      if (!blob) {
        toast("I didn't catch anything — try again, or type it.", "bad");
        return;
      }

      // The browser's recogniser gave us nothing. Send the recording instead.
      setTranscribing(true);
      const res = await transcribeBlob(blob);
      setTranscribing(false);
      if (res.text) {
        setInput(res.text.slice(0, 2000));
        inputRef.current?.focus();
      } else {
        toast(res.error ?? "I couldn't make that out.", "bad");
      }
      return;
    }

    // ---- start ----
    heard.current = "";

    // Record in parallel. It costs nothing when the recogniser works, and it's
    // the difference between working and not when it silently doesn't.
    recorder.current = await record();

    listener.current = listen({
      onPartial: (t) => {
        heard.current = t;
        setInput(t.slice(0, 2000));
      },
      onFinal: (t) => {
        heard.current = t;
        setInput(t.slice(0, 2000));
      },
      // Only worth surfacing when there's no recording to fall back on.
      onError: (reason) => {
        if (!recorder.current) toast(speechErrorMessage(reason), "bad");
      },
      onEnd: () => {
        listener.current = null;
      },
    });

    if (!listener.current && !recorder.current) {
      toast("I couldn't reach your microphone — check the permission, or type it.", "bad");
      return;
    }
    setListening(true);
  }, [listening, toast]);

  // Never leave the microphone running when the panel closes.
  useEffect(() => {
    if (!open && (listener.current || recorder.current)) {
      listener.current?.cancel();
      listener.current = null;
      recorder.current?.cancel();
      recorder.current = null;
      setListening(false);
    }
  }, [open]);

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || busy) return;

      // History the model sees, then an empty bubble that fills as it streams.
      const history: Msg[] = [...msgs, { role: "user", content: question }];
      setMsgs([...history, { role: "assistant", content: "" }]);
      setInput("");
      setBusy(true);

      const fail = (m: string) =>
        setMsgs((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: "assistant", content: m, escalate: true };
          return next;
        });

      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: history.slice(-12).map((m) => ({ role: m.role, content: m.content })),
          }),
        });

        // Anything that isn't the stream is a normal JSON error from the API.
        if (!res.ok || !res.body || !res.headers.get("content-type")?.includes("event-stream")) {
          let msg = "I couldn't reach the server. Try again in a moment.";
          try {
            const j = await res.json();
            if (j?.error) msg = j.error;
          } catch {}
          fail(msg);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          // SSE frames are separated by a blank line.
          const frames = buf.split("\n\n");
          buf = frames.pop() ?? "";

          for (const frame of frames) {
            const line = frame.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;
            let ev: { t: string; text?: string; message?: string; escalate?: boolean; action?: any };
            try {
              ev = JSON.parse(line.slice(5).trim());
            } catch {
              continue;
            }

            if (ev.t === "delta" && ev.text) {
              const chunk = ev.text;
              setMsgs((prev) => {
                const next = [...prev];
                const last = next[next.length - 1]!;
                next[next.length - 1] = { ...last, content: last.content + chunk };
                return next;
              });
            } else if (ev.t === "action" && (ev.action?.kind === "transfer" || ev.action?.kind === "bill")) {
              const d = ev.action as TransferDraft | BillDraft;
              setMsgs((prev) => {
                const next = [...prev];
                next[next.length - 1] = { ...next[next.length - 1]!, draft: d };
                return next;
              });
            } else if (ev.t === "done") {
              setMsgs((prev) => {
                const next = [...prev];
                const last = next[next.length - 1]!;
                next[next.length - 1] = {
                  ...last,
                  escalate: !!ev.escalate,
                  content: last.content || "I'm not sure about that one.",
                };
                return next;
              });
            } else if (ev.t === "error") {
              fail(ev.message ?? "Something went wrong.");
            }
          }
        }
      } catch {
        fail("I lost connection there. Try again, or email support if it's urgent.");
      } finally {
        setBusy(false);
        inputRef.current?.focus();
      }
    },
    [msgs, busy],
  );

  /** Send the prepared transfer. The PIN is passed straight through, never kept. */
  async function confirmDraft(pin: string) {
    if (!draft || sending) return;
    setSending(true);
    try {
      if (draft.kind === "bill") {
        await action("/api/bills", {
          category: draft.category,
          provider: draft.provider,
          billerCode: draft.billerCode,
          itemCode: draft.itemCode,
          account: draft.phone,
          fiatAmount: draft.category === "airtime" ? draft.amountNgn : undefined,
          fundingSymbol: undefined,
          pin,
        });
      } else {
        await action("/api/send", {
          mode: "bank",
          symbol: draft.fiat,
          amount: draft.amount,
          fiat: draft.fiat,
          bankName: draft.bankName ?? undefined,
          accountNumber: draft.accountNumber,
          accountName: draft.beneficiaryName,
          pin,
        });
      }
      const what = draft.kind === "bill" ? (draft.category === "airtime" ? "Airtime sent." : "Data sent.") : "Sent. It's on its way.";
      setDraft(null);
      setMsgs((prev) => prev.map((m) => (m.draft ? { ...m, sent: true } : m)));
      setMsgs((prev) => [...prev, { role: "assistant", content: what }]);
      toast(draft.kind === "bill" ? "Purchase sent" : "Transfer sent", "good");
    } catch (e: any) {
      if (/pin/i.test(e.message ?? "")) setPinError(true);
      else setDraft(null);
      toast(e.message, "bad");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {/* Launcher — pinned inside the 480px app column, clear of the tab bar.
          Offset by the home-indicator inset too, or on a notched phone the tab
          bar sits higher than the launcher expects and it lands on the quick
          actions. */}
      {!open && (
        <div
          className="fixed left-1/2 -translate-x-1/2 w-full max-w-[480px] px-4 flex justify-end pointer-events-none z-40"
          style={{ bottom: "calc(96px + env(safe-area-inset-bottom))" }}
        >
          <button
            onClick={() => setOpen(true)}
            aria-label={`Ask ${NAME}`}
            className="pointer-events-auto grad-bg-135 w-[52px] h-[52px] rounded-full flex items-center justify-center text-[#04121A] shadow-[0_10px_28px_rgba(42,200,255,.35)] active:scale-95 transition"
          >
            <Icon name="message" size={22} strokeWidth={2} />
          </button>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-[480px] h-[90dvh] bg-[#0B0D14] border-t border-white/10 rounded-t-[26px] flex flex-col animate-sheet overflow-hidden">
            {/*
              The PIN pad lives INSIDE this panel, not beside it.

              As a separate fixed sheet it depended on the two overlays agreeing
              about z-index — and when they didn't, the pad opened behind the
              chat: there, invisible, untappable, so "Review & confirm with PIN"
              looked like it was ignoring every tap. A child cannot be painted
              behind its own parent, so this arrangement cannot fail that way.
            */}
            <PinPrompt
              inline
              open={!!draft}
              onClose={() => setDraft(null)}
              onPin={confirmDraft}
              error={pinError}
              busy={sending}
              title={draft?.kind === "bill" ? "Confirm this purchase" : "Confirm this transfer"}
              subtitle={
                draft
                  ? draft.kind === "bill"
                    ? `${draft.planName} · ${draft.provider} · ${draft.phone}`
                    : `${draft.fiat} ${draft.amount.toLocaleString()} to ${draft.beneficiaryName}`
                  : undefined
              }
            />

            {/* header */}
            <div className="flex items-center gap-3 px-5 pt-4 pb-3 border-b border-white/[.07] shrink-0">
              <div className="grad-bg-135 w-9 h-9 rounded-full flex items-center justify-center text-[#04121A] shrink-0">
                <Icon name="zap" size={18} fill="#04121A" strokeWidth={1.5} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-grotesk font-semibold text-[15px] leading-tight">{NAME}</div>
                <div className="font-sans text-[11.5px] text-white/40">Ttip assistant · here 24/7</div>
              </div>
              {msgs.length > 0 && (
                <button
                  onClick={() => setMsgs([])}
                  className="text-white/40 text-[11.5px] border border-white/10 rounded-full px-2.5 py-1 active:scale-95"
                >
                  Clear
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="w-8 h-8 rounded-full border border-white/10 flex items-center justify-center text-white/60 active:scale-95"
              >
                <Icon name="plus" size={15} strokeWidth={2.4} className="rotate-45" />
              </button>
            </div>

            {/* thread */}
            <div ref={scroller} className="flex-1 overflow-y-auto no-scrollbar px-4 py-4 flex flex-col gap-3">
              {msgs.length === 0 && (
                <div className="pt-2">
                  <div className="font-grotesk font-bold text-[20px] tracking-[-0.3px]">
                    Hi, I&apos;m {NAME}.
                  </div>
                  <p className="text-white/50 text-[13.5px] mt-1.5 leading-[1.55]">
                    Ask me anything about Ttip — fees, limits, deposits, payouts, bills. I can see
                    your account, so I can tell you exactly what&apos;s going on with it.
                  </p>
                  <div className="flex flex-col gap-2 mt-4">
                    {STARTERS.map((s) => (
                      <button
                        key={s}
                        onClick={() => send(s)}
                        className="text-left bg-surface border border-white/[.06] rounded-2xl px-4 py-3 text-[13px] text-white/75 active:scale-[.99]"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {msgs.map((m, i) => (
                <div key={i} className={m.role === "user" ? "self-end max-w-[84%]" : "self-start max-w-[92%]"}>
                  <div
                    className={
                      m.role === "user"
                        ? "bg-[#1A2230] border border-white/[.08] rounded-2xl rounded-br-md px-3.5 py-2.5 text-[13.5px] leading-[1.55] whitespace-pre-wrap"
                        : "bg-surface border border-white/[.06] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-[13.5px] leading-[1.55] whitespace-pre-wrap text-white/85"
                    }
                  >
                    {m.content || (busy && i === msgs.length - 1 ? <Typing /> : "")}
                  </div>
                  {m.role === "assistant" && m.draft && !m.sent && (
                    <button
                      onClick={() => { setPinError(false); setDraft(m.draft!); }}
                      className="mt-2 w-full text-left rounded-2xl border border-good/30 bg-good/[.07] px-4 py-3 active:scale-[.99]"
                    >
                      <div className="text-white/45 text-[11px]">
                        {m.draft.kind === "bill" ? (m.draft.category === "airtime" ? "Ready to buy" : "Ready to send") : "Ready to send"}
                      </div>
                      <div className="font-grotesk font-bold text-[19px] mt-0.5">
                        {m.draft.kind === "bill"
                          ? m.draft.category === "airtime"
                            ? `₦${m.draft.amountNgn.toLocaleString()} airtime`
                            : m.draft.planName
                          : `${m.draft.fiat} ${m.draft.amount.toLocaleString()}`}
                      </div>
                      <div className="text-white/60 text-[12px] mt-0.5">
                        {m.draft.kind === "bill"
                          ? `${m.draft.provider} · ${m.draft.phone}${m.draft.category === "data" ? ` · ₦${m.draft.amountNgn.toLocaleString()}` : ""}`
                          : `${m.draft.beneficiaryName} · ${m.draft.accountNumber}${m.draft.bankName ? ` · ${m.draft.bankName}` : ""}`}
                      </div>
                      {/* A pasted account the bank couldn't confirm is the one
                          case worth stopping on — say so instead of implying
                          the name was checked. */}
                      {m.draft.kind === "transfer" && m.draft.resolvedName === null && (
                        <div className="mt-2 text-warn text-[11.5px] leading-[1.4]">
                          Account name not confirmed — check the number is right.
                        </div>
                      )}
                      {m.draft.kind === "transfer" && m.draft.resolvedName && (
                        <div className="mt-2 text-good text-[11.5px]">
                          Bank confirms: {m.draft.resolvedName}
                        </div>
                      )}
                      <div className="mt-2 text-good font-grotesk font-semibold text-[12.5px]">
                        Review &amp; confirm with PIN →
                      </div>
                    </button>
                  )}
                  {m.role === "assistant" && m.sent && (
                    <div className="mt-2 text-good text-[12px]">Sent ✓</div>
                  )}
                  {m.role === "assistant" && m.escalate && (
                    <a
                      href={`mailto:${COMPANY.supportEmail}?subject=${encodeURIComponent("Help with my Ttip account")}`}
                      className="mt-2 inline-flex items-center gap-2 bg-good text-ink rounded-xl px-3.5 py-2 font-grotesk font-semibold text-[12.5px] active:scale-95"
                    >
                      <Icon name="mail" size={14} /> Email the team
                    </a>
                  )}
                </div>
              ))}
            </div>

            {/* composer */}
            <div className="shrink-0 border-t border-white/[.07] px-4 pt-3 pb-5">
              {listening && (
                <div className="flex items-center justify-center gap-2 pb-2 text-[12px] text-good">
                  <span className="w-2 h-2 rounded-full bg-good animate-pulse" />
                  Listening… tap the mic when you&apos;re done
                </div>
              )}
              {transcribing && (
                <div className="flex items-center justify-center gap-2 pb-2 text-[12px] text-white/55">
                  <span className="w-3 h-3 rounded-full border-2 border-white/20 border-t-good animate-spin" />
                  Reading that back…
                </div>
              )}
              <div className="flex items-end gap-2">
                {/* Photograph an account rather than typing ten digits. */}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = ""; // so the same photo can be sent twice
                    if (f) scan(f);
                  }}
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={busy || scanning}
                  aria-label="Send a photo of an account"
                  className="w-[46px] h-[46px] rounded-2xl bg-surface border border-white/[.08] flex items-center justify-center shrink-0 text-white/70 disabled:opacity-35 active:scale-95"
                >
                  <Icon name={scanning ? "activity" : "scan"} size={19} />
                </button>
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value.slice(0, 2000))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send(input);
                    }
                  }}
                  placeholder={`Ask ${NAME} anything…`}
                  className="flex-1 resize-none bg-surface border border-white/[.08] rounded-2xl px-4 py-3 text-[13.5px] outline-none focus:border-white/20 max-h-[110px]"
                />
                {/* Speak instead of typing. Falls back to the send button on
                    browsers with no speech recognition. */}
                {/* While listening, the mic must stay — it's the stop button. It used to
                    swap to Send the moment speech put text in the box, leaving no way
                    to stop except closing the chat. */}
                {canSpeak && (listening || !input.trim()) ? (
                  <button
                    onClick={toggleListening}
                    disabled={busy || scanning || transcribing}
                    aria-label={listening ? "Stop listening" : "Speak to Ada"}
                    className={`w-[46px] h-[46px] rounded-2xl flex items-center justify-center shrink-0 disabled:opacity-35 active:scale-95 ${
                      listening ? "bg-bad text-white" : "bg-surface border border-white/[.08] text-white/70"
                    }`}
                  >
                    <Icon name={listening ? "x" : "mic"} size={19} />
                  </button>
                ) : (
                  <button
                    onClick={() => send(input)}
                    disabled={busy || !input.trim()}
                    aria-label="Send"
                    className="w-[46px] h-[46px] rounded-2xl bg-good text-ink flex items-center justify-center shrink-0 disabled:opacity-35 active:scale-95"
                  >
                    <Icon name="arrowUp" size={19} strokeWidth={2.4} />
                  </button>
                )}
              </div>
              <p className="text-center text-white/30 text-[10.5px] mt-2.5 tracking-[0.2px] uppercase">
                {NAME} can make mistakes · we&apos;ll loop in the team when needed
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Typing() {
  return (
    <span className="inline-flex gap-1 items-center py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-[5px] h-[5px] rounded-full bg-white/45 animate-pulse"
          style={{ animationDelay: `${i * 160}ms` }}
        />
      ))}
    </span>
  );
}
