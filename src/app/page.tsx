import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { getUserId } from "@/lib/auth";

export default async function Landing() {
  const uid = await getUserId();
  if (uid) redirect("/home");

  return (
    <div className="app-shell" style={{ background: "radial-gradient(120% 70% at 50% -10%,#141A2E 0%,#07080D 60%)" }}>
      <div className="flex-1 flex flex-col items-center justify-center gap-7 text-center px-6 animate-rise">
        <Image src="/ttip-logo.png" alt="Ttip" width={96} height={96} className="rounded-[26px] shadow-[0_20px_60px_rgba(42,200,255,.25)]" priority />
        <div className="flex flex-col gap-3">
          <h1 className="font-grotesk font-bold text-[40px] leading-[1.05] tracking-[-1.2px]">
            Crypto in.
            <br />
            Cash out.
            <br />
            <span className="grad-text">Ttip anyone.</span>
          </h1>
          <p className="font-sans text-[15px] leading-[1.55] text-white/55 max-w-[280px] mx-auto">
            Swap BTC, ETH &amp; USDT to Naira, Cedis, Shillings or Rand in seconds — and tip friends, family and your crew instantly.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <span className="w-[22px] h-[6px] rounded-[3px]" style={{ background: "linear-gradient(90deg,#2AC8FF,#3DF5B0)" }} />
          <span className="w-[6px] h-[6px] rounded-[3px] bg-white/20" />
          <span className="w-[6px] h-[6px] rounded-[3px] bg-white/20" />
        </div>
      </div>
      <div className="flex flex-col gap-3 px-6 pb-8">
        <Link href="/signup" className="grad-bg h-[56px] rounded-[28px] flex items-center justify-center font-grotesk font-semibold text-[17px] text-[#04121A] shadow-glow active:scale-[.98]">
          Get started
        </Link>
        <Link href="/login" className="h-[56px] rounded-[28px] border border-white/15 flex items-center justify-center font-medium text-[16px] text-white active:scale-[.98]">
          I already have an account
        </Link>
      </div>
    </div>
  );
}
