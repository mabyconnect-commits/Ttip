import "server-only";
import { COMPANY } from "./company";

/**
 * Outbound email.
 *
 * Talks to Resend over plain HTTP rather than pulling in an SDK — one fetch,
 * no dependency, and swapping provider means changing this file only.
 *
 * Configure with:
 *   RESEND_API_KEY   required; without it sending is disabled
 *   MAIL_FROM        e.g. "Ttip <no-reply@ttip.site>" (must be a verified domain)
 *
 * Fails CLOSED: if it isn't configured, `sendMail` returns false rather than
 * pretending to have sent. A password-reset flow that silently drops its email
 * locks people out of their money, so the caller has to know.
 */

export function mailEnabled(): boolean {
  return !!process.env.RESEND_API_KEY;
}

function fromAddress(): string {
  return process.env.MAIL_FROM || `${COMPANY.product} <no-reply@${COMPANY.domain}>`;
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: fromAddress(),
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Plain, no-images reset email — renders the same everywhere and never trips a spam filter. */
export function passwordResetEmail(name: string, link: string, minutes: number) {
  const greeting = name?.trim() ? `Hi ${name.trim().split(" ")[0]},` : "Hi,";
  return {
    subject: `Reset your ${COMPANY.product} password`,
    text: [
      greeting,
      "",
      `Use this link to set a new ${COMPANY.product} password:`,
      link,
      "",
      `The link works once and expires in ${minutes} minutes.`,
      "",
      "If you didn't ask to reset your password, ignore this email — your password hasn't changed and your money is untouched.",
      "",
      `— ${COMPANY.product}`,
    ].join("\n"),
    html: `
<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0d0f17">
  <h1 style="font-size:20px;margin:0 0 16px">Reset your ${COMPANY.product} password</h1>
  <p style="font-size:15px;line-height:1.55;margin:0 0 20px">${greeting}<br>Tap the button to set a new password.</p>
  <p style="margin:0 0 24px">
    <a href="${link}" style="display:inline-block;background:#3DF5B0;color:#07080D;font-weight:600;text-decoration:none;padding:13px 22px;border-radius:12px;font-size:15px">Set a new password</a>
  </p>
  <p style="font-size:13px;color:#555;line-height:1.55;margin:0 0 8px">
    The link works once and expires in ${minutes} minutes.
  </p>
  <p style="font-size:13px;color:#555;line-height:1.55;margin:0 0 20px">
    If you didn't ask for this, ignore this email — your password hasn't changed and your money is untouched.
  </p>
  <p style="font-size:12px;color:#888;margin:0">If the button doesn't work, paste this into your browser:<br>${link}</p>
</div>`.trim(),
  };
}
