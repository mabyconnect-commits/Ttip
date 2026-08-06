/**
 * "in 30min from now", "tomorrow at 9am" — reading a time out of a request.
 *
 * This exists because of what happened without it. Someone wrote "Can you send
 * money to this account in 30min from now please", and the transfer parser took
 * the account, took the amount, and sent it immediately — the four words that
 * changed WHEN were simply not looked at. Silently ignoring a time and moving
 * money now is worse than not supporting scheduling at all: the user asked for
 * one thing and got another, irreversibly.
 *
 * So the rule this file serves is: if a message names a time, the send is
 * either scheduled for it or refused. Never dropped.
 *
 * Pure and dependency-free — `now` is passed in, so every case is exactly
 * testable and nothing here depends on the server's clock or locale.
 */

/** How far ahead we will hold a transfer. Beyond this, say so rather than guess. */
export const MAX_SCHEDULE_DAYS = 90;

/** Minimum lead time. Below this it isn't scheduling, it's just sending. */
export const MIN_SCHEDULE_MS = 60_000;

export interface ScheduledWhen {
  /** When to send. */
  at: Date;
  /** How the user said it, for reading back: "in 30 minutes", "tomorrow at 9:00 am". */
  said: string;
}

const UNIT_MS: [RegExp, number][] = [
  [/^(?:min|mins|minute|minutes|m)$/i, 60_000],
  [/^(?:h|hr|hrs|hour|hours)$/i, 3_600_000],
  [/^(?:d|day|days)$/i, 86_400_000],
  [/^(?:wk|wks|week|weeks)$/i, 7 * 86_400_000],
];

/** "30min", "2 hours", "1hr", "3 days" — a duration, anywhere in the text. */
const IN_DURATION = /\bin\s+(?:the\s+next\s+)?(\d{1,4})\s*(min|mins|minute|minutes|m|h|hr|hrs|hour|hours|d|day|days|wk|wks|week|weeks)\b/i;

/** "at 9am", "by 6:30 pm", "at 18:00". */
const CLOCK = /\b(?:at|by)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;

/** A bare day word that moves the date. */
const TOMORROW = /\btomorrow\b|\btomorow\b|\btmr+w?\b/i;
const TONIGHT = /\btonight\b/i;
const NEXT_WEEK = /\bnext\s+week\b/i;

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

function clockLabel(h: number, m: number): string {
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

/**
 * The time a message asks for, or null when it names none.
 *
 * Returns a time in the FUTURE or null — "at 9am" said at 10am means tomorrow
 * morning, because nobody schedules a payment for an hour that has gone.
 */
export function parseWhen(text: string, now: Date = new Date()): ScheduledWhen | null {
  const q = (text ?? "").trim();
  if (!q) return null;

  // "in 30 minutes" — the least ambiguous form there is, so it wins.
  const dur = q.match(IN_DURATION);
  if (dur) {
    const n = Number(dur[1]);
    const unit = dur[2];
    const ms = UNIT_MS.find(([re]) => re.test(unit))?.[1];
    if (ms && n > 0) {
      const label = ms === 60_000 ? "minute" : ms === 3_600_000 ? "hour" : ms === 86_400_000 ? "day" : "week";
      return { at: new Date(now.getTime() + n * ms), said: `in ${plural(n, label)}` };
    }
  }

  // A clock time, optionally on another day.
  const clock = q.match(CLOCK);
  const tomorrow = TOMORROW.test(q);
  const tonight = TONIGHT.test(q);
  const nextWeek = NEXT_WEEK.test(q);
  const dayIndex = DAY_NAMES.findIndex((d) => new RegExp(`\\b${d}\\b`, "i").test(q));

  if (!clock && !tomorrow && !tonight && !nextWeek && dayIndex < 0) return null;

  const at = new Date(now.getTime());
  let hour: number;
  let minute = 0;

  if (clock) {
    hour = Number(clock[1]);
    minute = clock[2] ? Number(clock[2]) : 0;
    const ampm = clock[3]?.toLowerCase();
    if (hour > 23 || minute > 59) return null;
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    // No am/pm on a small number: "at 6" from someone awake in the evening
    // means 6pm far more often than 6am, and a payment sent twelve hours early
    // is the mistake that costs. Take the NEXT occurrence of that hour instead.
    if (!ampm && hour >= 1 && hour <= 11) {
      const asAm = new Date(at);
      asAm.setHours(hour, minute, 0, 0);
      if (asAm.getTime() <= now.getTime()) hour += 12;
    }
  } else if (tonight) {
    hour = 20;
  } else {
    // A day with no clock time: 9am is the ordinary hour to pay someone.
    hour = 9;
  }

  at.setHours(hour, minute, 0, 0);

  if (tomorrow) at.setDate(at.getDate() + 1);
  else if (nextWeek) at.setDate(at.getDate() + 7);
  else if (dayIndex >= 0) {
    // The next time that weekday comes round — today only if it hasn't passed.
    let delta = (dayIndex - at.getDay() + 7) % 7;
    if (delta === 0 && at.getTime() <= now.getTime()) delta = 7;
    at.setDate(at.getDate() + delta);
  }

  // A time already gone means the next day. "at 9am" at 10am is tomorrow.
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);

  const dayPart = tomorrow
    ? "tomorrow"
    : nextWeek
      ? "next week"
      : dayIndex >= 0
        ? DAY_NAMES[dayIndex].replace(/^\w/, (c) => c.toUpperCase())
        : at.toDateString() === new Date(now).toDateString()
          ? "today"
          : "tomorrow";

  return { at, said: `${dayPart} at ${clockLabel(at.getHours(), at.getMinutes())}` };
}

/**
 * Why a requested time can't be used, or null when it's fine.
 *
 * The code matters as much as the message: "too soon" means fall back to
 * sending now, which is what the user wanted anyway, while "too far" has to be
 * SAID — quietly sending in ninety seconds something they asked for in a year
 * is the failure this whole file exists to prevent.
 */
export type ScheduleProblem = { code: "too-soon" | "too-far" | "unreadable"; message: string };

export function scheduleProblem(at: Date, now: Date = new Date()): ScheduleProblem | null {
  const ms = at.getTime() - now.getTime();
  if (!Number.isFinite(ms)) return { code: "unreadable", message: "I couldn't work out that time." };
  if (ms < MIN_SCHEDULE_MS) {
    return { code: "too-soon", message: "That's less than a minute away, so I'll just send it now." };
  }
  if (ms > MAX_SCHEDULE_DAYS * 86_400_000) {
    return { code: "too-far", message: `I can only hold a transfer for ${MAX_SCHEDULE_DAYS} days.` };
  }
  return null;
}
