"use client";

import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { Icon, type IconName } from "@/components/Icon";

/**
 * The first three minutes.
 *
 * Signing up dropped people straight onto a home screen showing ₦0 and five
 * icons, with nothing telling them what to do first. Everything they actually
 * need — verifying, a PIN, an account number to fund — is behind a menu they
 * have no reason to open yet, so the honest outcome was a new user staring at
 * an empty balance and closing the app.
 *
 * So the work is stated, in order, with the reason each step exists. It
 * disappears completely once the account is set up: this is scaffolding, not
 * furniture, and a permanent checklist on the home screen of a finished account
 * would be clutter.
 */

interface Step {
  key: string;
  title: string;
  detail: string;
  icon: IconName;
  href: string;
  done: boolean;
}

export function GettingStarted() {
  const { state } = useApp();
  const router = useRouter();
  const { user, portfolio } = state;

  const verified = user.kycStatus === "verified";
  const pending = user.kycStatus === "pending";
  const funded = portfolio.totalFiat > 0;

  const steps: Step[] = [
    {
      key: "verify",
      title: pending ? "Verification in review" : "Verify your identity",
      detail: pending
        ? "We're checking your details — this is usually quick."
        : "Confirm your BVN to unlock withdrawals and get your own account number.",
      icon: "shield",
      href: "/account/kyc",
      done: verified,
    },
    {
      key: "pin",
      title: "Set your transaction PIN",
      detail: "Four digits. It's what stops anyone holding your unlocked phone from sending money.",
      icon: "lock",
      href: "/account/security",
      done: user.hasPin,
    },
    {
      key: "fund",
      title: "Add your first money",
      detail: verified
        ? "Transfer naira to your account number, or send crypto from any chain."
        : "Send crypto from any chain — you can do this before verifying.",
      icon: "arrowDown",
      href: "/deposit",
      done: funded,
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;

  // Finished accounts don't need a checklist.
  if (doneCount === steps.length) return null;

  // The first thing still to do — highlighted, because a list of three equal
  // options is a decision, and a decision is where people stop.
  const next = steps.find((s) => !s.done)!;

  return (
    <div className="mx-5 mt-4 rounded-3xl bg-surface border border-white/[.06] overflow-hidden">
      <div className="px-5 pt-4 pb-3 flex items-center justify-between">
        <div>
          <div className="font-grotesk font-semibold text-[14.5px]">Finish setting up</div>
          <div className="text-white/45 text-[11.5px] mt-0.5">
            {doneCount} of {steps.length} done · takes about two minutes
          </div>
        </div>
        <div className="flex gap-1.5">
          {steps.map((s) => (
            <span
              key={s.key}
              className={`w-6 h-1 rounded-full ${s.done ? "bg-good" : "bg-white/15"}`}
              aria-hidden
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col">
        {steps.map((s) => {
          const isNext = s.key === next.key;
          return (
            <button
              key={s.key}
              onClick={() => router.push(s.href)}
              disabled={s.done}
              className={`flex items-center gap-3.5 px-5 py-3.5 text-left border-t border-white/[.05] ${
                s.done ? "opacity-45" : "active:bg-white/5"
              } ${isNext ? "bg-good/[.05]" : ""}`}
            >
              <span
                className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                  s.done ? "bg-good/15 text-good" : isNext ? "bg-good/15 text-good" : "bg-surface2 text-white/70"
                }`}
              >
                <Icon name={s.done ? "check" : s.icon} size={17} strokeWidth={s.done ? 2.6 : 2} />
              </span>
              <div className="flex-1 min-w-0">
                <div className={`font-medium text-[13.5px] ${s.done ? "line-through" : ""}`}>{s.title}</div>
                {!s.done && <div className="text-white/45 text-[11.5px] mt-0.5 leading-[1.4]">{s.detail}</div>}
              </div>
              {!s.done && <Icon name="chevronRight" size={16} className="text-white/30 shrink-0" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
