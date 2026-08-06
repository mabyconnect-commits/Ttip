import "server-only";

/**
 * Sending a text message.
 *
 * Two Nigerian aggregators, behind one function, chosen by whichever is
 * configured: Termii and Africa's Talking. Both are a single POST; neither is
 * worth an abstraction beyond this.
 *
 * Never throws. A reply that fails to send must not roll back a transfer that
 * already happened — the user's money moved, and the right response to a
 * carrier hiccup is a loud log, not an exception unwinding a payout.
 */

type Provider = "termii" | "africastalking" | null;

export function smsProvider(): Provider {
  if (process.env.TERMII_API_KEY?.trim()) return "termii";
  if (process.env.AT_API_KEY?.trim() && process.env.AT_USERNAME?.trim()) return "africastalking";
  return null;
}

export function smsEnabled(): boolean {
  return smsProvider() !== null;
}

/** The number or sender id our messages come from. */
export function smsSender(): string {
  return process.env.SMS_SENDER_ID?.trim() || "Ttip";
}

export async function sendSms(to: string, body: string): Promise<boolean> {
  const provider = smsProvider();
  if (!provider) {
    console.error(`[sms] not configured — would have sent to ${to}: ${body}`);
    return false;
  }

  try {
    if (provider === "termii") {
      const res = await fetch("https://api.ng.termii.com/api/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to,
          from: smsSender(),
          sms: body,
          type: "plain",
          channel: process.env.TERMII_CHANNEL || "generic",
          api_key: process.env.TERMII_API_KEY,
        }),
      });
      if (!res.ok) {
        console.error(`[sms] termii ${res.status}: ${await res.text().catch(() => "")}`);
        return false;
      }
      return true;
    }

    const res = await fetch("https://api.africastalking.com/version1/messaging", {
      method: "POST",
      headers: {
        apiKey: process.env.AT_API_KEY!,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        username: process.env.AT_USERNAME!,
        to,
        message: body,
        ...(process.env.SMS_SENDER_ID ? { from: process.env.SMS_SENDER_ID } : {}),
      }),
    });
    if (!res.ok) {
      console.error(`[sms] africastalking ${res.status}: ${await res.text().catch(() => "")}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[sms] send threw", e);
    return false;
  }
}

/**
 * Normalise a Nigerian number to E.164.
 *
 * The same SIM arrives as 08113866493, 2348113866493, +2348113866493 and
 * 8113866493 depending on the carrier and the handset. They are one number, and
 * treating them as four is how a linked phone stops being recognised.
 */
export function normalisePhone(raw: string): string | null {
  const d = (raw ?? "").replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (!d) return null;
  if (/^234\d{10}$/.test(d)) return `+${d}`;
  if (/^0\d{10}$/.test(d)) return `+234${d.slice(1)}`;
  if (/^\d{10}$/.test(d)) return `+234${d}`;
  // Anything else that looks like a full international number is kept as-is;
  // guessing a country code for it would be worse than not matching.
  if (/^\d{11,15}$/.test(d)) return `+${d}`;
  return null;
}
