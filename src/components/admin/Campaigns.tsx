"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/Icon";

/**
 * Influencer deals, on the admin screen only.
 *
 * Progress is computed from what actually happened — real provider-settled
 * deposits, a real trade, a real balance still held — not from anything the
 * influencer reports. "Qualified" is the number the fee is owed on.
 */

interface Campaign {
  id: string;
  name: string;
  status: string;
  influencer: { name: string; username: string; email: string; code: string };
  note: string | null;
  rules: { minDepositNgn: number; requireTrade: boolean; holdHours: number; minHoldNgn: number };
  targetCount: number;
  rewardNgn: number;
  startsAt: string;
  paidAt: string | null;
  signups: number;
  qualified: number;
  complete: boolean;
  costPerQualified: number | null;
  pending: { name: string; reason: string }[];
}

const ngn = (n: number) => "₦" + Math.round(n).toLocaleString("en-US");

export function Campaigns() {
  const [list, setList] = useState<Campaign[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const [form, setForm] = useState({
    name: "",
    influencer: "",
    targetCount: "100",
    rewardNgn: "40000",
    minDepositNgn: "1000",
    minHoldNgn: "1000",
    holdHours: "72",
    requireTrade: true,
    note: "",
  });

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/campaigns");
      if (!r.ok) return setList([]);
      setList((await r.json()).campaigns ?? []);
    } catch {
      setList([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/admin/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          influencer: form.influencer,
          note: form.note || undefined,
          targetCount: Number(form.targetCount),
          rewardNgn: Number(form.rewardNgn),
          minDepositNgn: Number(form.minDepositNgn),
          minHoldNgn: Number(form.minHoldNgn),
          holdHours: Number(form.holdHours),
          requireTrade: form.requireTrade,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not create");
      setMsg(`Created. ${d.influencer} shares their code ${d.code}.`);
      setOpen(false);
      setForm({ ...form, name: "", influencer: "", note: "" });
      load();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function mark(id: string, status: "paid" | "cancelled" | "active") {
    if (status === "paid" && !confirm("Mark this campaign paid? This records the payout — it doesn't send money.")) return;
    await fetch("/api/admin/campaigns", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    load();
  }

  return (
    <>
      <div className="flex items-center justify-between mt-6 mb-2">
        <span className="font-grotesk font-semibold text-[14px]">Influencer campaigns</span>
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-[12px] border border-white/15 rounded-full px-3 py-1 active:scale-95"
        >
          {open ? "Cancel" : "New"}
        </button>
      </div>

      {msg && <div className="text-[12px] text-good mb-2 px-1">{msg}</div>}

      {open && (
        <div className="rounded-2xl bg-surface border border-white/[.08] p-4 mb-3 flex flex-col gap-2.5">
          <Input label="Campaign name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="Aug — Naija crypto TikTok" />
          <Input label="Influencer (email or @username)" value={form.influencer} onChange={(v) => setForm({ ...form, influencer: v })} placeholder="@kola" />
          <div className="grid grid-cols-2 gap-2.5">
            <Input label="Target signups" value={form.targetCount} onChange={(v) => setForm({ ...form, targetCount: v })} numeric />
            <Input label="Reward (₦)" value={form.rewardNgn} onChange={(v) => setForm({ ...form, rewardNgn: v })} numeric />
            <Input label="Min deposit (₦)" value={form.minDepositNgn} onChange={(v) => setForm({ ...form, minDepositNgn: v })} numeric />
            <Input label="Must still hold (₦)" value={form.minHoldNgn} onChange={(v) => setForm({ ...form, minHoldNgn: v })} numeric />
            <Input label="Hold for (hours)" value={form.holdHours} onChange={(v) => setForm({ ...form, holdHours: v })} numeric />
          </div>
          <label className="flex items-center gap-2 text-[12.5px] text-white/70 px-1">
            <input
              type="checkbox"
              checked={form.requireTrade}
              onChange={(e) => setForm({ ...form, requireTrade: e.target.checked })}
            />
            Must swap or buy at least once
          </label>
          <Input label="Note (internal)" value={form.note} onChange={(v) => setForm({ ...form, note: v })} placeholder="Agreed terms, contact…" />
          <button
            onClick={create}
            disabled={busy || !form.name || !form.influencer}
            className="h-[46px] rounded-xl bg-good text-ink font-grotesk font-semibold text-[13.5px] disabled:opacity-40 active:scale-[.98]"
          >
            {busy ? "Creating…" : "Create campaign"}
          </button>
          <p className="text-white/35 text-[11px] leading-[1.5]">
            Only real, provider-settled deposits count. Bonuses and platform credit never qualify anyone.
          </p>
        </div>
      )}

      {list === null && <div className="text-white/40 text-[12.5px] px-1">Loading…</div>}
      {list?.length === 0 && (
        <div className="text-white/40 text-[12.5px] px-1">
          No campaigns yet. Create one and give the influencer their referral code.
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {list?.map((c) => {
          const pct = Math.min(100, (c.qualified / Math.max(1, c.targetCount)) * 100);
          return (
            <div key={c.id} className="rounded-2xl bg-surface border border-white/[.08] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-grotesk font-semibold text-[14px] truncate">{c.name}</div>
                  <div className="text-white/45 text-[11.5px] truncate">
                    {c.influencer.name} · @{c.influencer.username} · code {c.influencer.code}
                  </div>
                </div>
                <span
                  className="text-[10.5px] uppercase tracking-wide rounded-full px-2 py-[3px] shrink-0"
                  style={
                    c.status === "paid"
                      ? { color: "#3DF5B0", background: "rgba(61,245,176,.12)" }
                      : c.status === "cancelled"
                        ? { color: "#FF7A8A", background: "rgba(255,122,138,.12)" }
                        : { color: "rgba(255,255,255,.6)", background: "rgba(255,255,255,.07)" }
                  }
                >
                  {c.status}
                </span>
              </div>

              <div className="flex items-baseline justify-between mt-3">
                <span className="font-grotesk font-bold text-[20px]">
                  {c.qualified}
                  <span className="text-white/35 text-[14px]"> / {c.targetCount}</span>
                </span>
                <span className="text-white/45 text-[11.5px]">{c.signups} signed up</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/[.08] mt-2 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: c.complete ? "#3DF5B0" : "#2AC8FF" }} />
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[11.5px] text-white/50">
                <span>Pays {ngn(c.rewardNgn)}</span>
                <span>
                  ≥{ngn(c.rules.minDepositNgn)} deposited{c.rules.requireTrade ? " · traded" : ""} · held{" "}
                  {c.rules.holdHours}h · still ≥{ngn(c.rules.minHoldNgn)}
                </span>
                {c.costPerQualified !== null && <span>{ngn(c.costPerQualified)} per qualified user</span>}
              </div>

              {c.complete && c.status === "active" && (
                <div className="mt-3 rounded-xl bg-good/[.08] border border-good/25 px-3.5 py-2.5 flex items-center gap-2">
                  <Icon name="check" size={14} className="text-good shrink-0" strokeWidth={2.6} />
                  <span className="text-[12.5px] text-white/80">Target hit — {ngn(c.rewardNgn)} is owed.</span>
                </div>
              )}

              {c.pending.length > 0 && (
                <details className="mt-3">
                  <summary className="text-white/45 text-[11.5px] cursor-pointer list-none">
                    {c.pending.length} not counted yet — why?
                  </summary>
                  <div className="flex flex-col gap-1 mt-2">
                    {c.pending.map((p, i) => (
                      <div key={i} className="flex justify-between text-[11.5px] gap-3">
                        <span className="text-white/60 truncate">{p.name}</span>
                        <span className="text-white/35 shrink-0">{p.reason}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              <div className="flex gap-2 mt-3">
                {c.status === "active" && (
                  <>
                    <button
                      onClick={() => mark(c.id, "paid")}
                      disabled={!c.complete}
                      className="flex-1 h-[38px] rounded-xl bg-good text-ink font-grotesk font-semibold text-[12.5px] disabled:opacity-35 active:scale-[.98]"
                    >
                      Mark paid
                    </button>
                    <button
                      onClick={() => mark(c.id, "cancelled")}
                      className="h-[38px] px-4 rounded-xl border border-white/15 text-white/70 text-[12.5px] active:scale-[.98]"
                    >
                      Cancel
                    </button>
                  </>
                )}
                {c.status !== "active" && (
                  <button
                    onClick={() => mark(c.id, "active")}
                    className="h-[38px] px-4 rounded-xl border border-white/15 text-white/70 text-[12.5px] active:scale-[.98]"
                  >
                    Reopen
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
  numeric,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  numeric?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[11px] text-white/45 ml-1">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(numeric ? e.target.value.replace(/[^0-9]/g, "") : e.target.value)}
        placeholder={placeholder}
        inputMode={numeric ? "numeric" : undefined}
        className="mt-1 w-full h-[44px] rounded-xl bg-surface2 border border-white/10 px-3.5 text-[13.5px] outline-none focus:border-brand-cyan/50"
      />
    </label>
  );
}
