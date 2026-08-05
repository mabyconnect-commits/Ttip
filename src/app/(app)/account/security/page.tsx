"use client";

import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/context/AppContext";
import { apiPost } from "@/lib/client";
import { BackHeader, GradientButton, Sheet } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { PinPad } from "@/components/PinPad";
import { unlockSession } from "@/components/AppLock";
import { apiGet } from "@/lib/client";
import { deviceCanAuthenticate, registerPasskey } from "@/lib/passkey";

export default function SecurityPage() {
  const { state, refresh, toast } = useApp();
  const hasPin = state.user.hasPin;

  // password
  const [pwOpen, setPwOpen] = useState(false);
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [pwLoading, setPwLoading] = useState(false);

  // passkeys — Face ID / fingerprint
  const [canBiometric, setCanBiometric] = useState(false);
  const [passkeys, setPasskeys] = useState<{ id: string; label: string | null; lastUsedAt: string | null }[]>([]);
  const [pkBusy, setPkBusy] = useState(false);

  const loadPasskeys = useCallback(async () => {
    try {
      const res = await apiGet<{ passkeys: typeof passkeys }>("/api/auth/passkey");
      setPasskeys(res.passkeys ?? []);
    } catch {
      /* the section simply shows nothing rather than an error */
    }
  }, []);

  useEffect(() => {
    deviceCanAuthenticate().then(setCanBiometric);
    loadPasskeys();
  }, [loadPasskeys]);

  async function addPasskey() {
    setPkBusy(true);
    const res = await registerPasskey();
    setPkBusy(false);
    if (res.ok) {
      toast(`${res.data?.added ?? "This device"} added`, "good");
      loadPasskeys();
    } else if (res.error) {
      toast(res.error, "bad");
    }
  }

  async function removePasskey(id: string, label: string) {
    if (!confirm(`Remove ${label}? You'll sign in with your password on that device.`)) return;
    try {
      await fetch(`/api/auth/passkey?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      toast("Device removed", "good");
      loadPasskeys();
    } catch {
      toast("Couldn't remove that device", "bad");
    }
  }

  // pin
  const [pinOpen, setPinOpen] = useState(false);
  const [stage, setStage] = useState<"enter" | "confirm">("enter");
  const [first, setFirst] = useState("");
  const [clearToken, setClearToken] = useState(0);
  const [pinErr, setPinErr] = useState(false);

  async function changePassword() {
    if (cur.length < 1) return toast("Enter current password", "bad");
    if (next.length < 8) return toast("New password must be 8+ characters", "bad");
    setPwLoading(true);
    try {
      await apiPost("/api/security", { currentPassword: cur, newPassword: next }, "PATCH");
      toast("Password updated", "good");
      setPwOpen(false); setCur(""); setNext("");
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setPwLoading(false);
    }
  }

  function openPin() {
    setStage("enter"); setFirst(""); setPinErr(false); setClearToken((t) => t + 1); setPinOpen(true);
  }

  async function onPinComplete(pin: string) {
    if (stage === "enter") {
      setFirst(pin);
      setStage("confirm");
      setClearToken((t) => t + 1);
      return;
    }
    // confirm
    if (pin !== first) {
      setPinErr(true);
      setTimeout(() => { setPinErr(false); setStage("enter"); setFirst(""); setClearToken((t) => t + 1); }, 600);
      toast("PINs didn't match — try again", "bad");
      return;
    }
    try {
      await apiPost("/api/pin", { pin });
      unlockSession(); // don't lock the user out right after they set it
      await refresh();
      toast(hasPin ? "PIN changed" : "PIN set — app lock is on", "good");
      setPinOpen(false);
    } catch (e: any) {
      toast(e.message, "bad");
    }
  }

  async function removePin() {
    if (!confirm("Remove your PIN? You won't be able to withdraw until you set a new one.")) return;
    await fetch("/api/pin", { method: "DELETE" });
    await refresh();
    toast("App-lock PIN removed", "info");
  }

  return (
    <div className="flex flex-col flex-1 px-[22px] min-h-0">
      <BackHeader title="Security" />
      <div className="flex-1 overflow-y-auto no-scrollbar pb-6">
        <div className="mt-2 bg-surface border border-white/[.06] rounded-[18px] overflow-hidden">
          <Row icon="lock" label="Password" sub="Change your account password" onClick={() => setPwOpen(true)} />
          {/* One PIN does both jobs. It was labelled "app-lock PIN", so someone
              looking for a withdrawal PIN never found it. */}
          <Row
            icon="grid"
            label={hasPin ? "Change transaction PIN" : "Set transaction PIN"}
            sub={hasPin ? "Required for withdrawals and to open the app" : "Required before you can withdraw"}
            onClick={openPin}
            border
          />
          {hasPin && (
            <Row icon="trash" label="Remove PIN" sub="Withdrawals will be blocked" onClick={removePin} border danger />
          )}
        </div>

        {!hasPin && (
          <button
            onClick={openPin}
            className="mt-3 w-full rounded-2xl px-4 py-3.5 flex items-start gap-2.5 text-left bg-warn/[.08] border border-warn/25 active:scale-[.99]"
          >
            <Icon name="shield" size={15} className="text-warn mt-0.5 shrink-0" />
            <span className="text-[12.5px] text-white/75 leading-[1.5]">
              <b className="text-white">You can&apos;t withdraw yet.</b> Set a 4-digit transaction PIN — it&apos;s
              what stops anyone who picks up your unlocked phone from emptying your account.
            </span>
          </button>
        )}

        {/* Face ID / fingerprint */}
        {(canBiometric || passkeys.length > 0) && (
          <>
            <div className="mt-6 mb-2 px-1 font-grotesk font-semibold text-[13px] text-white/60">
              Face ID &amp; fingerprint
            </div>
            <div className="bg-surface border border-white/[.06] rounded-[18px] overflow-hidden">
              {passkeys.map((p, i) => (
                <div key={p.id} className={`flex items-center gap-3 px-4 py-3.5 ${i ? "border-t border-white/[.06]" : ""}`}>
                  <span className="w-9 h-9 rounded-full bg-good/[.12] text-good flex items-center justify-center shrink-0">
                    <Icon name="shield" size={16} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-[14.5px] truncate">{p.label ?? "This device"}</div>
                    <div className="text-white/40 text-[11.5px]">
                      {p.lastUsedAt ? `Last used ${new Date(p.lastUsedAt).toLocaleDateString()}` : "Not used yet"}
                    </div>
                  </div>
                  <button
                    onClick={() => removePasskey(p.id, p.label ?? "this device")}
                    className="text-[12.5px] text-bad font-semibold px-2 py-1 active:scale-95"
                  >
                    Remove
                  </button>
                </div>
              ))}
              {canBiometric && (
                <Row
                  icon="shield"
                  label={pkBusy ? "Waiting for your device…" : passkeys.length ? "Add another device" : "Turn on Face ID / fingerprint"}
                  sub={passkeys.length ? "Sign in on this phone too" : "Sign in without typing your password"}
                  onClick={addPasskey}
                  border={passkeys.length > 0}
                />
              )}
            </div>
            <div className="mt-2 px-1 text-[11.5px] text-white/40 leading-[1.5]">
              Your fingerprint never leaves your phone — it unlocks a key held in the phone itself, and we
              only ever see the signature. Your password still works, and still opens your account if you
              lose the device.
            </div>
          </>
        )}

        <div className="mt-4 rounded-2xl px-4 py-3 flex items-start gap-2.5 text-[12px] text-white/50 bg-surface border border-white/[.06]">
          <Icon name="lock" size={14} className="text-white/40 mt-0.5 shrink-0" />
          <span>Your PIN is stored securely (hashed) and never leaves our servers in plain text.</span>
        </div>
      </div>

      {/* change password sheet */}
      <Sheet open={pwOpen} onClose={() => setPwOpen(false)} title="Change password">
        <div className="flex flex-col gap-2.5">
          <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} placeholder="Current password" className="bg-surface border border-white/[.08] rounded-2xl px-4 h-[52px] outline-none text-[14px] focus:border-brand-cyan/50" />
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="New password (8+ characters)" className="bg-surface border border-white/[.08] rounded-2xl px-4 h-[52px] outline-none text-[14px] focus:border-brand-cyan/50" />
          <GradientButton onClick={changePassword} loading={pwLoading} className="mt-1">Update password</GradientButton>
        </div>
      </Sheet>

      {/* pin sheet */}
      <Sheet open={pinOpen} onClose={() => setPinOpen(false)} title={stage === "enter" ? (hasPin ? "Enter new PIN" : "Create a PIN") : "Confirm your PIN"}>
        <div className="py-4">
          <PinPad onComplete={onPinComplete} clearToken={clearToken} error={pinErr} />
        </div>
      </Sheet>
    </div>
  );
}

function Row({ icon, label, sub, onClick, border, danger }: { icon: any; label: string; sub: string; onClick: () => void; border?: boolean; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`w-full flex items-center gap-3.5 px-4 py-3.5 active:bg-white/5 ${border ? "border-t border-white/[.05]" : ""}`}>
      <span className="w-9 h-9 rounded-full bg-surface2 flex items-center justify-center shrink-0" // Themed, not a literal white: an inline style is the one thing the
      // light-mode CSS cannot remap, so this icon vanished on a white card.
      style={{ color: danger ? "#FF7A8A" : "rgb(var(--fg) / .8)" }}>
        <Icon name={icon} size={18} />
      </span>
      <div className="flex-1 text-left">
        <div className="font-medium text-[14.5px]" style={danger ? { color: "#FF7A8A" } : undefined}>{label}</div>
        <div className="text-white/40 text-[11.5px]">{sub}</div>
      </div>
      <Icon name="chevronRight" size={16} className="text-white/30" />
    </button>
  );
}
