/**
 * What an SMS transfer is allowed to be.
 *
 * SMS is the weakest surface we have. There is no screen to check a name on, no
 * confirmation the user can read twice, no way to delete what was sent, and the
 * authorisation is a code on a piece of paper. So it gets the smallest limits of
 * anything in the app, and it can only pay people the user has already paid
 * before from a device we trust more.
 *
 * That last rule does most of the work: a stolen phone with the code sheet can
 * still only send money to accounts its owner had already saved, capped, from a
 * number bound to one account. It cannot invent a destination.
 *
 * Pure, so the numbers are testable and one place defines them.
 */

/** Most a single SMS transfer may move. */
export function smsMaxTransfer(): number {
  return envNumber("SMS_MAX_TRANSFER_NGN", 20_000, 0, 500_000);
}

/** Most all SMS transfers together may move in a rolling 24 hours. */
export function smsDailyCap(): number {
  return envNumber("SMS_DAILY_CAP_NGN", 50_000, 0, 2_000_000);
}

/** How long a pending SMS transfer waits for its code before it lapses. */
export function smsConfirmWindowMs(): number {
  return envNumber("SMS_CONFIRM_MINUTES", 10, 1, 60) * 60_000;
}

/**
 * A blank env var is an empty string and Number("") is 0 — which for a cap
 * would mean "nothing may ever be sent", and for a window "everything lapses
 * instantly". Blank means unset.
 */
function envNumber(key: string, fallback: number, min: number, max: number): number {
  const raw = (process.env[key] ?? "").trim();
  const n = Number(raw);
  return raw !== "" && Number.isFinite(n) && n > min && n <= max ? n : fallback;
}

export interface CapCheck {
  ok: boolean;
  reason?: string;
}

/** Whether `amount` fits, given what has already gone out by SMS today. */
export function withinCaps(amount: number, sentToday: number, fiat = "NGN"): CapCheck {
  const money = (n: number): string => `${fiat === "NGN" ? "₦" : fiat + " "}${n.toLocaleString("en-US")}`;

  if (!(amount > 0)) return { ok: false, reason: "Enter an amount." };
  if (amount > smsMaxTransfer()) {
    return { ok: false, reason: `SMS transfers are capped at ${money(smsMaxTransfer())}. Use the app for more.` };
  }
  if (sentToday + amount > smsDailyCap()) {
    const left = Math.max(0, smsDailyCap() - sentToday);
    return {
      ok: false,
      reason: `That's over your ${money(smsDailyCap())} daily SMS limit — ${money(left)} left today. Use the app.`,
    };
  }
  return { ok: true };
}
