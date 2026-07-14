import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { grad } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function PublicTipPage({ params }: { params: { username: string } }) {
  const username = params.username.toLowerCase().replace(/^@/, "");
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) notFound();

  const initial = user.name.charAt(0).toUpperCase();
  const received = await prisma.transaction.count({ where: { userId: user.id, type: "ttip_in" } });

  return (
    <div className="app-shell items-center" style={{ background: "radial-gradient(120% 60% at 50% -10%,#141A2E 0%,#07080D 60%)" }}>
      <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6 text-center w-full">
        <div className="flex items-center gap-2 absolute top-6 left-6">
          <Image src="/ttip-logo.png" alt="Ttip" width={28} height={28} className="rounded-lg" />
          <span className="font-grotesk font-bold">Ttip</span>
        </div>

        <div
          className="w-[92px] h-[92px] rounded-full flex items-center justify-center font-grotesk font-bold text-[34px] text-[#04121A]"
          style={{ background: grad(user.avatarGradient), border: "3px solid rgba(42,200,255,.4)" }}
        >
          {initial}
        </div>
        <div>
          <div className="font-grotesk font-bold text-[24px]">
            {user.name} {user.verified && <span className="text-brand-cyan text-base">✓</span>}
          </div>
          <div className="text-good font-medium text-[13px] mt-0.5">@{user.username}</div>
        </div>
        <p className="text-white/55 text-[14px] max-w-[300px]">
          Tip {user.name.split(" ")[0]} instantly — from any crypto, straight to their cash. 🔥 {user.streakDays}-day streak · {received} tips received.
        </p>

        <div className="flex flex-col gap-3 w-full max-w-[320px] mt-2">
          <Link href={`/ttip?to=${user.username}`} className="grad-bg h-[54px] rounded-[27px] flex items-center justify-center font-grotesk font-semibold text-[16px] text-[#04121A] shadow-glow">
            ⚡ Ttip @{user.username}
          </Link>
          <Link href="/signup" className="h-[54px] rounded-[27px] border border-white/15 flex items-center justify-center font-medium text-[15px]">
            Get the app
          </Link>
        </div>
      </div>
      <p className="text-white/30 text-[12px] pb-6">Powered by Ttip · Crypto in. Cash out. Tip anyone.</p>
    </div>
  );
}
