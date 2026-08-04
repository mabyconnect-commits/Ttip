"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { TabBar } from "@/components/TabBar";
import { GettingStarted } from "@/components/GettingStarted";
import { AssetIcon } from "@/components/AssetIcon";
import { Avatar, Sheet } from "@/components/ui";
import { Icon, type IconName } from "@/components/Icon";
import { formatFiat, formatUsd, formatCrypto } from "@/lib/format";
import { FIATS } from "@/lib/constants";
import { payoutCurrencySupported } from "@/lib/settlement/payout-country";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Private, HideBalanceToggle } from "@/components/PrivateBalance";

export default function HomePage() {
  const { state, action, toast } = useApp();
  const router = useRouter();
  const { user, portfolio } = state;
  const [fiatOpen, setFiatOpen] = useState(false);

  // Everything the user actually holds — crypto AND fiat (e.g. NGN) — so the
  // list matches the total balance. Fall back to the primary crypto rails when
  // the wallet is empty, so the screen isn't blank.
  const held = portfolio.assets.filter((a) => a.amount > 0);
  const shown = held.length ? held : portfolio.assets.filter((a) => a.kind === "crypto").slice(0, 3);

  async function setFiat(code: string) {
    setFiatOpen(false);
    try {
      await action("/api/profile", { defaultFiat: code }, "PATCH");
      toast(`Switched to ${code}`, "good");
    } catch (e: any) {
      toast(e.message, "bad");
    }
  }

  const [whole, cents] = formatFiat(portfolio.totalFiat, portfolio.fiat).split(".");

  return (
    <>
      {/* header */}
      <div className="flex items-center justify-between px-[22px] pt-3 pb-2">
        <button className="flex items-center gap-3" onClick={() => router.push("/profile")}>
          <Avatar gradient={user.avatarGradient} initial={user.initial} size={40} />
          <div className="text-left">
            <div className="font-grotesk font-semibold text-[15px] tracking-[-0.2px]">{user.name.split(" ")[0]}</div>
            <div className="font-sans text-[12px] text-white/45">@{user.username}</div>
          </div>
        </button>
        <div className="flex gap-2">
          <button onClick={() => router.push("/rates")} className="h-9 px-3 rounded-full border border-white/10 flex items-center gap-1.5 text-white/80 active:scale-95">
            <Icon name="activity" size={15} />
            <span className="font-grotesk font-semibold text-[12.5px]">Rates</span>
          </button>
          <ThemeToggle compact />
          <button onClick={() => router.push("/notifications")} className="w-9 h-9 rounded-full border border-white/10 flex items-center justify-center text-white/70 active:scale-95">
            <Icon name="bell" size={17} />
          </button>
          <button onClick={() => router.push("/referrals")} className="w-9 h-9 rounded-full border border-white/10 flex items-center justify-center text-white/70 active:scale-95">
            <Icon name="gift" size={17} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar pb-4">
        {/* balance */}
        <div className="mx-5 mt-4 rounded-3xl p-6 bg-surface border border-white/[.06]">
          <div className="flex justify-between items-center">
            <div className="font-sans text-[12px] text-white/40 tracking-[0.3px] uppercase">Total balance</div>
            <div className="flex items-center gap-1.5">
              {/* Not everyone wants their balance on show — on a bus, or when
                  the phone is being handed to someone. */}
              <HideBalanceToggle />
              <button onClick={() => setFiatOpen(true)} className="flex items-center gap-1 font-grotesk font-semibold text-[12px] text-white/70 border border-white/10 rounded-full px-2.5 py-1 active:scale-95">
                {portfolio.fiat}
                <Icon name="chevronDown" size={13} />
              </button>
            </div>
          </div>
          <div className="font-grotesk font-bold text-[42px] leading-none mt-4 tracking-[-1.5px] text-white">
            <Private mask="••••••">
              {whole}
              <span className="text-[22px] text-white/35">.{cents ?? "00"}</span>
            </Private>
          </div>
          <div className="font-sans text-[12.5px] text-white/40 mt-2">
            ≈ <Private mask="•••••">{formatUsd(portfolio.totalUsd)}</Private>
          </div>
        </div>

        {/* First-run steps. Renders nothing once the account is set up. */}
        <GettingStarted />

        {/* add money / send */}
        <div className="grid grid-cols-2 gap-2.5 px-5 mt-3">
          <button onClick={() => router.push("/deposit")} className="h-[50px] rounded-2xl bg-good text-ink flex items-center justify-center gap-2 font-grotesk font-semibold text-[14px] active:scale-[.98]">
            <Icon name="arrowDown" size={17} strokeWidth={2.4} /> Add money
          </button>
          <button onClick={() => router.push("/send-out")} className="h-[50px] rounded-2xl border border-white/12 flex items-center justify-center gap-2 font-grotesk font-semibold text-[14px] active:scale-[.98]">
            <Icon name="arrowUp" size={17} strokeWidth={2.4} /> Send out
          </button>
        </div>

        {/* quick actions */}
        <div className="grid grid-cols-5 gap-2 px-5 pt-5">
          <QuickAction icon="plus" label="Buy" onClick={() => router.push("/buy")} />
          <QuickAction icon="swap" label="Swap" onClick={() => router.push("/swap")} />
          <QuickAction icon="zap" label="Ttip" accent onClick={() => router.push("/ttip")} />
          {/* Virtual cards aren't live yet — say so rather than opening a screen
              that can't actually issue one. */}
          <QuickAction icon="card" label="Card" soon onClick={() => toast("Virtual cards are coming soon", "info")} />
          <QuickAction icon="bills" label="Bills" onClick={() => router.push("/bills")} />
        </div>

        {/* assets */}
        <div className="px-5 pt-7">
          <div className="flex justify-between items-baseline mb-3">
            <span className="font-grotesk font-semibold text-[14px] tracking-[-0.2px]">Your assets</span>
            <button onClick={() => router.push("/account/transactions")} className="font-sans text-[12px] text-white/45 active:text-white/70">
              Activity
            </button>
          </div>
          <div className="flex flex-col gap-1.5">
            {shown.map((a) => (
              <button key={a.symbol} onClick={() => router.push("/swap?from=" + a.symbol)} className="flex items-center gap-3 bg-surface border border-white/[.05] rounded-2xl px-4 py-3.5 active:scale-[.99] transition">
                <AssetIcon color={a.color} glyph={a.glyph} />
                <div className="flex-1 text-left">
                  <div className="font-sans font-semibold text-[14px]">{a.name}</div>
                  <div className="font-sans text-[11.5px] text-white/40">
                    {/* Hiding the total but leaving ₦315,381 on the row below
                        would hide nothing at all. */}
                    <Private mask="••••">
                      {a.kind === "fiat" ? formatFiat(a.amount, a.symbol, { decimals: 2 }) : `${formatCrypto(a.amount, a.symbol)} ${a.symbol}`}
                    </Private>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-grotesk font-semibold text-[14px]">
                    <Private mask="••••">{formatFiat(a.fiatValue, portfolio.fiat, { decimals: 0 })}</Private>
                  </div>
                  {a.kind === "crypto" && (
                    <div className="font-sans font-medium text-[11px] tabular-nums" style={{ color: a.change24h >= 0 ? "#3DF5B0" : "#FF7A8A" }}>
                      {a.change24h >= 0 ? "+" : "−"}{Math.abs(a.change24h).toFixed(1)}%
                    </div>
                  )}
                </div>
              </button>
            ))}
            {shown.every((a) => a.amount === 0) && (
              <div className="text-center text-white/40 text-[13px] py-5">
                No crypto yet.{" "}
                <button onClick={() => router.push("/deposit")} className="text-good">
                  Add money
                </button>{" "}
                to get started.
              </div>
            )}
          </div>
        </div>
      </div>

      <TabBar />

      <Sheet open={fiatOpen} onClose={() => setFiatOpen(false)} title="Display currency">
        <div className="flex flex-col gap-2">
          {/* Supported first, then the ones we can't settle yet — shown but
              disabled, so the list still reads as the full African roadmap. */}
          {[...FIATS].sort((a, b) => Number(payoutCurrencySupported(b.code)) - Number(payoutCurrencySupported(a.code))).map((f) => {
            const supported = payoutCurrencySupported(f.code);
            return (
              <button
                key={f.code}
                onClick={() => supported && setFiat(f.code)}
                disabled={!supported}
                className={`flex items-center gap-3 bg-surface border border-white/[.06] rounded-2xl px-4 py-3.5 ${supported ? "active:scale-[.99]" : "opacity-45 cursor-not-allowed"}`}
              >
                <span className="text-xl">{f.flag}</span>
                <span className="flex-1 text-left font-medium text-[14px]">{f.name}</span>
                {!supported && (
                  <span className="text-[10px] uppercase tracking-wide text-white/45 border border-white/15 rounded-full px-2 py-[3px]">
                    Coming soon
                  </span>
                )}
                {supported && portfolio.fiat === f.code && <Icon name="check" size={16} className="text-good" strokeWidth={2.6} />}
              </button>
            );
          })}
        </div>
      </Sheet>
    </>
  );
}

function QuickAction({ icon, label, onClick, accent, soon }: { icon: IconName; label: string; onClick: () => void; accent?: boolean; soon?: boolean }) {
  return (
    <button onClick={onClick} className={`flex flex-col items-center gap-2 active:scale-95 transition ${soon ? "opacity-45" : ""}`}>
      <div
        className="w-[56px] h-[56px] rounded-2xl flex items-center justify-center border relative"
        style={
          accent
            ? { background: "rgba(61,245,176,.10)", borderColor: "rgba(61,245,176,.30)", color: "#3DF5B0" }
            : { background: "rgb(var(--surface2))", borderColor: "rgb(var(--fg) / .08)", color: "rgb(var(--fg))" }
        }
      >
        <Icon name={icon} size={22} strokeWidth={1.9} />
      </div>
      <span className="font-sans font-medium text-[11.5px] text-white/60">{soon ? "Soon" : label}</span>
    </button>
  );
}
