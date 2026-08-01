import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function PublicTipPage({ params }: { params: { username: string } }) {
  const username = params.username.toLowerCase().replace(/^@/, "");
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) notFound();

  const viewerId = await getUserId();
  const loggedIn = !!viewerId;
  const tipHref = loggedIn
    ? `/ttip?to=${user.username}`
    : `/login?next=${encodeURIComponent(`/ttip?to=${user.username}`)}`;

  const initial = user.name.charAt(0).toUpperCase();
  const received = await prisma.transaction.count({ where: { userId: user.id, type: "ttip_in" } });

  return (
    <div
      className="app-shell items-center"
      style={{ background: "radial-gradient(90% 45% at 50% 0%, rgba(61,245,176,0.06), transparent 60%), #07080D" }}
    >
      <div className="w-full flex items-center gap-2 px-6 pt-6">
        <Image src="/ttip-logo.png" alt="Ttip" width={26} height={26} className="rounded-lg" />
        <span className="font-grotesk font-bold text-[15px]">Ttip</span>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6 text-center w-full">
        <div
          className="w-[88px] h-[88px] rounded-full flex items-center justify-center font-grotesk font-bold text-[32px] text-[#04121A]"
          style={{ background: `linear-gradient(${user.avatarGradient})` }}
        >
          {initial}
        </div>

        <div>
          <div className="font-grotesk font-bold text-[24px] tracking-[-0.5px] flex items-center justify-center gap-1.5">
            {user.name}
            {user.verified && (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" className="text-brand-cyan" aria-hidden>
                <path d="m5 13 4 4L19 7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
          <div className="text-white/45 font-medium text-[13px] mt-1">@{user.username}</div>
        </div>

        <p className="text-white/55 text-[14px] leading-[1.55] max-w-[300px]">
          Tip {user.name.split(" ")[0]} instantly — from any crypto, straight to cash.
          {received > 0 && <span className="text-white/40"> · {received} tip{received === 1 ? "" : "s"} received</span>}
        </p>

        <div className="flex flex-col gap-2.5 w-full max-w-[320px] mt-2">
          <Link href={tipHref} className="h-[54px] rounded-2xl flex items-center justify-center font-grotesk font-semibold text-[16px] bg-good text-ink active:scale-[.98] transition">
            Ttip @{user.username}
          </Link>
          <Link href={loggedIn ? "/home" : "/signup"} className="h-[54px] rounded-2xl border border-white/12 flex items-center justify-center font-grotesk font-medium text-[15px] active:scale-[.98] transition">
            {loggedIn ? "Open Ttip" : "Get the app"}
          </Link>
        </div>
      </div>

      <p className="text-white/30 text-[12px] pb-7 px-6 text-center">Powered by Ttip · Crypto in. Cash out. Tip anyone.</p>
    </div>
  );
}
