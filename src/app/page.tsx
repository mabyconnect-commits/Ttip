import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { getUserId } from "@/lib/auth";
import { Icon, type IconName } from "@/components/Icon";
import { COMPANY, PRODUCT_OF } from "@/lib/company";

export default async function Landing() {
  const uid = await getUserId();
  if (uid) redirect("/home");

  return (
    <div className="min-h-dvh bg-ink text-white overflow-x-hidden">
      {/* nav */}
      <header className="sticky top-0 z-30 backdrop-blur-md bg-ink/70 border-b border-white/[.06]">
        <div className="max-w-[1080px] mx-auto px-5 h-[60px] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Image src="/ttip-logo.png" alt="Ttip" width={30} height={30} className="rounded-[9px]" />
            <span className="font-grotesk font-bold text-[18px]">Ttip</span>
          </div>
          <div className="flex items-center gap-2.5">
            <Link href="/login" className="text-[13.5px] text-white/70 hover:text-white px-3 py-2">Sign in</Link>
            <Link href="/signup" className="text-[13.5px] font-grotesk font-semibold bg-good text-ink rounded-full px-4 py-2 active:scale-[.98]">
              Get started
            </Link>
          </div>
        </div>
      </header>

      {/* hero */}
      <section className="relative" style={{ background: "radial-gradient(110% 60% at 50% -10%,#141A2E 0%,transparent 60%)" }}>
        <div className="max-w-[1080px] mx-auto px-5 pt-16 pb-14 text-center flex flex-col items-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[.03] px-3.5 py-1.5 text-[12px] text-white/60 mb-7">
            <span className="w-1.5 h-1.5 rounded-full bg-good" /> Crypto to cash, across Africa
          </span>
          <h1 className="font-grotesk font-bold text-[38px] sm:text-[54px] leading-[1.04] tracking-[-1.4px] max-w-[720px]">
            Turn crypto into{" "}
            <span className="grad-text">local money</span>
            {" "}in seconds.
          </h1>
          <p className="font-sans text-[15.5px] sm:text-[17px] leading-[1.6] text-white/55 max-w-[560px] mt-5">
            Deposit any coin on any chain, get paid in Naira, Cedis, Shillings or Rand at a sharp rate, and cash
            out straight to your bank — or tip anyone, instantly.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 mt-8 w-full sm:w-auto">
            <Link href="/signup" className="grad-bg h-[54px] px-8 rounded-[27px] flex items-center justify-center font-grotesk font-semibold text-[16px] text-[#04121A] shadow-glow active:scale-[.98]">
              Create your account
            </Link>
            <Link href="/login" className="h-[54px] px-8 rounded-[27px] border border-white/15 flex items-center justify-center font-medium text-[15px] active:scale-[.98]">
              I have an account
            </Link>
          </div>
          <p className="text-[12.5px] text-white/35 mt-5">Free to join · Identity-verified · Non-custodial deposits</p>
        </div>
      </section>

      {/* how it works */}
      <section className="max-w-[1080px] mx-auto px-5 py-14">
        <SectionHead eyebrow="How it works" title="Three steps, no stress" />
        <div className="grid sm:grid-cols-3 gap-4 mt-9">
          {STEPS.map((s, i) => (
            <div key={s.title} className="rounded-[20px] bg-surface border border-white/[.06] p-6">
              <div className="w-10 h-10 rounded-full bg-good/12 text-good flex items-center justify-center font-grotesk font-bold">{i + 1}</div>
              <div className="font-grotesk font-semibold text-[17px] mt-4">{s.title}</div>
              <p className="text-white/50 text-[13.5px] leading-[1.6] mt-2">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* features */}
      <section className="max-w-[1080px] mx-auto px-5 py-14">
        <SectionHead eyebrow="Why Ttip" title="Built for how money really moves" />
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-9">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-[20px] bg-surface border border-white/[.06] p-6">
              <span className="w-10 h-10 rounded-2xl bg-surface2 flex items-center justify-center text-good"><Icon name={f.icon} size={20} /></span>
              <div className="font-grotesk font-semibold text-[15.5px] mt-4">{f.title}</div>
              <p className="text-white/50 text-[13px] leading-[1.6] mt-1.5">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* trust band */}
      <section className="max-w-[1080px] mx-auto px-5 py-14">
        <div className="rounded-[24px] border border-white/[.08] bg-surface p-8 sm:p-10 grid sm:grid-cols-3 gap-8">
          {TRUST.map((t) => (
            <div key={t.title}>
              <span className="text-good"><Icon name={t.icon} size={22} /></span>
              <div className="font-grotesk font-semibold text-[15.5px] mt-3">{t.title}</div>
              <p className="text-white/50 text-[13px] leading-[1.6] mt-1.5">{t.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-[1080px] mx-auto px-5 py-14 text-center">
        <h2 className="font-grotesk font-bold text-[30px] sm:text-[38px] tracking-[-1px]">Ready to cash out?</h2>
        <p className="text-white/55 text-[15px] mt-3 max-w-[440px] mx-auto">Create an account and make your first swap in minutes.</p>
        <Link href="/signup" className="inline-flex mt-7 grad-bg h-[54px] px-9 rounded-[27px] items-center justify-center font-grotesk font-semibold text-[16px] text-[#04121A] shadow-glow active:scale-[.98]">
          Get started free
        </Link>
      </section>

      {/* footer */}
      <footer className="border-t border-white/[.07] mt-6">
        <div className="max-w-[1080px] mx-auto px-5 py-10 flex flex-col gap-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <Image src="/ttip-logo.png" alt="Ttip" width={26} height={26} className="rounded-[8px]" />
              <span className="font-grotesk font-bold">Ttip</span>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-white/50">
              <Link href="/terms" className="hover:text-white/80">Terms of Service</Link>
              <Link href="/privacy" className="hover:text-white/80">Privacy Policy</Link>
              <a href={`mailto:${COMPANY.supportEmail}`} className="hover:text-white/80">{COMPANY.supportEmail}</a>
            </div>
          </div>
          <div className="text-white/35 text-[12.5px] leading-[1.7] border-t border-white/[.06] pt-5">
            <p>{PRODUCT_OF}{COMPANY.rcNumber ? ` (${COMPANY.rcNumber})` : ""}, registered in {COMPANY.country}.</p>
            <p className="mt-1">
              Ttip facilitates the exchange of digital assets for local currency. Digital assets are volatile;
              use of the service is subject to our Terms and identity-verification requirements.
            </p>
            <p className="mt-2">© {new Date().getFullYear()} {COMPANY.legalName}. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function SectionHead({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="text-center">
      <div className="text-good text-[12.5px] font-grotesk font-semibold uppercase tracking-[1.5px]">{eyebrow}</div>
      <h2 className="font-grotesk font-bold text-[27px] sm:text-[34px] tracking-[-0.8px] mt-2">{title}</h2>
    </div>
  );
}

const STEPS = [
  { title: "Deposit any crypto", body: "Send BTC, ETH, USDT, USDC, SOL and more — from any of 70+ supported chains — to your unique address." },
  { title: "Get local currency", body: "Your deposit is converted to Naira, Cedis, Shillings or Rand at a live, competitive rate you can see up front." },
  { title: "Cash out or tip", body: "Withdraw straight to your bank account, or tip friends, family and your crew instantly with a link." },
];

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  { icon: "swap", title: "Any coin, any chain", body: "Deposit once and for all — 70+ networks supported, settled automatically to your balance." },
  { icon: "activity", title: "Sharp, honest rates", body: "Rates track the live P2P market with a thin, disclosed spread. No hidden markup." },
  { icon: "bank", title: "Instant bank payouts", body: "Withdraw to any Nigerian bank (and more) — most payouts settle in seconds." },
  { icon: "zap", title: "Tip anyone", body: "Send value to any @username with a shareable link, even before they join." },
  { icon: "shield", title: "Identity-verified", body: "BVN/NIN verification keeps the platform safe and compliant before any withdrawal." },
  { icon: "gift", title: "Multi-currency", body: "Hold and cash out in several African currencies from one account." },
];

const TRUST: { icon: IconName; title: string; body: string }[] = [
  { icon: "shield", title: "KYC & compliance", body: "We verify identities and monitor for fraud in line with regulatory requirements." },
  { icon: "lock", title: "Secured by design", body: "Encrypted in transit, hashed passwords and PINs, and an app-lock on every device." },
  { icon: "bank", title: "Non-custodial deposits", body: "Crypto deposits are settled through a non-custodial provider across 70+ chains." },
];
