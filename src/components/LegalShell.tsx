import Link from "next/link";
import Image from "next/image";
import { COMPANY, PRODUCT_OF, LEGAL_EFFECTIVE } from "@/lib/company";

/** Shared frame for the Terms and Privacy pages — public, no auth. */
export function LegalShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-ink text-white">
      <div className="max-w-[720px] mx-auto px-6 py-8">
        <Link href="/" className="inline-flex items-center gap-2.5 mb-8">
          <Image src="/ttip-logo.png" alt="Ttip" width={34} height={34} className="rounded-[10px]" />
          <span className="font-grotesk font-bold text-lg">Ttip</span>
        </Link>

        <h1 className="font-grotesk font-bold text-[30px] tracking-[-0.6px]">{title}</h1>
        <p className="text-white/45 text-[13px] mt-2">
          {PRODUCT_OF}. Effective {LEGAL_EFFECTIVE}.
        </p>

        <div className="legal-body mt-7 flex flex-col gap-6 text-[14.5px] leading-[1.65] text-white/70">
          {children}
        </div>

        <div className="mt-12 pt-6 border-t border-white/[.08] text-white/40 text-[12.5px]">
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/terms" className="hover:text-white/70">Terms of Service</Link>
            <Link href="/privacy" className="hover:text-white/70">Privacy Policy</Link>
            <a href={`mailto:${COMPANY.supportEmail}`} className="hover:text-white/70">{COMPANY.supportEmail}</a>
          </div>
          <p className="mt-3">© {new Date().getFullYear()} {COMPANY.legalName}. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
}

/** A titled section within a legal document. */
export function LegalSection({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-grotesk font-semibold text-[17px] text-white mb-2">{heading}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}
