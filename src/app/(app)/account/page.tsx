"use client";

import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { Avatar } from "@/components/ui";
import { TabBar } from "@/components/TabBar";
import { Icon, type IconName } from "@/components/Icon";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CashbackCard } from "@/components/CashbackCard";
import { COMPANY, PRODUCT_OF } from "@/lib/company";

export default function AccountPage() {
  const { state, logout } = useApp();
  const router = useRouter();
  const { user } = state;

  const kycLabel =
    user.kycStatus === "verified" ? "Verified" : user.kycStatus === "pending" ? "In review" : "Verify your account";
  const kycColor = user.kycStatus === "verified" ? "#3DF5B0" : user.kycStatus === "pending" ? "#FFC85B" : "#2AC8FF";

  const items: { icon: IconName; label: string; sub: string; href: string; badge?: string; badgeColor?: string }[] = [
    { icon: "user", label: "My profile", sub: "Edit your account information", href: "/account/profile" },
    { icon: "shield", label: "KYC", sub: "Verify your account", href: "/account/kyc", badge: kycLabel, badgeColor: kycColor },
    { icon: "gauge", label: "Spending limits", sub: "See your tier & limits", href: "/account/limits" },
    { icon: "list", label: "Transactions", sub: "See all transactions", href: "/account/transactions" },
    { icon: "bank", label: "Beneficiaries", sub: "Manage saved bank accounts", href: "/account/beneficiaries" },
    { icon: "bell", label: "Notifications", sub: "Notification preferences", href: "/account/notifications" },
    { icon: "lock", label: "Security", sub: "Password & transaction PIN", href: "/account/security" },
    { icon: "headset", label: "Support", sub: "Talk to us", href: "/account/support" },
  ];

  // Admin-only tools. The link is hidden for everyone else purely for tidiness —
  // the endpoints behind it authorise server-side and 404 for non-admins.
  if (user.isAdmin) {
    items.push({ icon: "gauge", label: "Funding audit", sub: "Unfunded balances & demo accounts", href: "/account/admin" });
  }

  return (
    <>
      <div className="flex items-center justify-between px-[22px] pt-3.5 pb-3">
        <div className="font-grotesk font-bold text-[22px]">Account</div>
        <ThemeToggle />
      </div>
      <div className="flex-1 overflow-y-auto no-scrollbar px-[22px] pb-4">
        {/* profile header */}
        <div className="flex flex-col items-center gap-2 py-3">
          <Avatar gradient={user.avatarGradient} initial={user.initial} size={80} />
          <div className="font-grotesk font-bold text-[20px] tracking-[-0.3px]">{user.name}</div>
          <div className="text-white/45 text-[13px]">@{user.username}</div>
          <span
            className="text-[12px] font-semibold rounded-full px-3 py-1 mt-0.5"
            style={{ color: kycColor, background: `${kycColor}1f` }}
          >
            {user.kycStatus === "verified" ? "Verified" : user.kycStatus === "pending" ? "In review" : "Unverified"}
          </span>
        </div>

        {/* refer & earn */}
        <button
          onClick={() => router.push("/referrals")}
          className="w-full flex items-center gap-3 rounded-2xl p-4 mt-1 bg-surface border border-white/[.06]"
        >
          <span className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(61,245,176,.10)", border: "1px solid rgba(61,245,176,.28)" }}>
            <Icon name="gift" size={19} className="text-good" />
          </span>
          <div className="flex-1 text-left">
            <div className="font-grotesk font-semibold text-[15px]">Refer &amp; Earn</div>
            <div className="text-white/55 text-[12px]">Earn 25% of your friends&apos; fees — for life</div>
          </div>
          <Icon name="chevronRight" size={18} className="text-white/40" />
        </button>

        {/* cashback */}
        <CashbackCard />

        {/* menu */}
        <div className="mt-4 bg-surface border border-white/[.06] rounded-[20px] overflow-hidden">
          {items.map((it, i) => (
            <button
              key={it.label}
              onClick={() => router.push(it.href)}
              className={`w-full flex items-center gap-3.5 px-4 py-3.5 active:bg-white/5 ${i > 0 ? "border-t border-white/[.05]" : ""}`}
            >
              <span className="w-9 h-9 rounded-full bg-surface2 flex items-center justify-center text-white/80 shrink-0">
                <Icon name={it.icon} size={18} />
              </span>
              <div className="flex-1 text-left">
                <div className="font-medium text-[14.5px]">{it.label}</div>
                <div className="text-white/40 text-[11.5px]">{it.sub}</div>
              </div>
              {it.badge && (
                <span className="text-[11px] font-semibold mr-1" style={{ color: it.badgeColor }}>
                  {it.badge}
                </span>
              )}
              <Icon name="chevronRight" size={16} className="text-white/30" />
            </button>
          ))}
        </div>

        <button
          onClick={logout}
          className="w-full mt-4 flex items-center justify-center gap-2 rounded-2xl border border-bad/30 bg-bad/10 text-bad py-3.5 font-medium text-[14px] active:scale-[.99]"
        >
          <Icon name="logout" size={17} /> Log out
        </button>
        <div className="flex items-center justify-center gap-4 mt-5 text-[12px] text-white/40">
          <a href="/terms" className="hover:text-white/70">Terms</a>
          <a href="/privacy" className="hover:text-white/70">Privacy</a>
          <a href={`mailto:${COMPANY.supportEmail}`} className="hover:text-white/70">Support</a>
        </div>
        <div className="text-center text-white/25 text-[11px] mt-2.5">Ttip · v1.0.0</div>
        <div className="text-center text-white/25 text-[11px] mt-0.5">{PRODUCT_OF}</div>
      </div>
      <TabBar />
    </>
  );
}
