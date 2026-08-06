import test from "node:test";
import assert from "node:assert/strict";
import { parseWhen, scheduleProblem, MAX_SCHEDULE_DAYS } from "../src/lib/assistant/when";

/**
 * Reading a time out of a money request.
 *
 * Verbatim from a chat: "8113866493 Opay — Can you send money to this account
 * in 30min from now please". The account was taken, the amount was taken, and
 * ₦2,000 left immediately. Silently ignoring a time is worse than not
 * supporting scheduling: the user asked for one thing and irreversibly got
 * another.
 */

// A fixed clock, so every case is exactly reproducible.
const NOON = new Date("2026-08-06T12:00:00.000Z");
const mins = (d: Date) => Math.round((d.getTime() - NOON.getTime()) / 60_000);

test("the message that started this", () => {
  const w = parseWhen("Can you send money to this account in 30min from now please", NOON);
  assert.ok(w);
  assert.equal(mins(w!.at), 30);
  assert.equal(w!.said, "in 30 minutes");
});

test("durations, however they're written", () => {
  assert.equal(mins(parseWhen("in 5 minutes", NOON)!.at), 5);
  assert.equal(mins(parseWhen("in 45mins", NOON)!.at), 45);
  assert.equal(mins(parseWhen("send it in 2 hours", NOON)!.at), 120);
  assert.equal(mins(parseWhen("in 1hr", NOON)!.at), 60);
  assert.equal(mins(parseWhen("in 3 days", NOON)!.at), 3 * 24 * 60);
  assert.equal(parseWhen("in 1 week", NOON)!.said, "in 1 week");
});

test("a request with no time is not a schedule", () => {
  // Every one of these must stay an immediate send. A false schedule is as bad
  // as a missed one — the money doesn't go when they expected it to.
  for (const t of [
    "send 2k to 8113866493 Opay",
    "send 5000 to my sister",
    "what's my balance",
    "send 30 usdt to this address",
    "",
  ]) {
    assert.equal(parseWhen(t, NOON), null, t);
  }
});

test("an hour that has passed means the next one, never the last", () => {
  // 12:00 UTC. "at 9am" is tomorrow morning; nobody schedules a payment for an
  // hour that has gone, and sending it immediately would be the same bug.
  const w = parseWhen("pay her at 9am", NOON)!;
  assert.ok(w.at.getTime() > NOON.getTime());
});

test("a bare small hour is read as the next one, not twelve hours early", () => {
  // "at 6" with no am/pm, said in the afternoon, means 6pm. A payment sent
  // twelve hours early is the mistake that costs.
  const w = parseWhen("send it at 6", NOON)!;
  assert.ok(w.at.getTime() > NOON.getTime());
  assert.ok(w.at.getTime() - NOON.getTime() <= 24 * 3600_000);
});

test("tomorrow moves the day", () => {
  const w = parseWhen("send it tomorrow at 9am", NOON)!;
  const hours = (w.at.getTime() - NOON.getTime()) / 3600_000;
  assert.ok(hours > 12 && hours < 36, `got ${hours}h`);
  assert.match(w.said, /^tomorrow at /);
});

test("too soon falls back to sending now; too far has to be said", () => {
  const soon = new Date(NOON.getTime() + 10_000);
  assert.equal(scheduleProblem(soon, NOON)?.code, "too-soon");

  const far = new Date(NOON.getTime() + (MAX_SCHEDULE_DAYS + 1) * 86_400_000);
  assert.equal(scheduleProblem(far, NOON)?.code, "too-far");

  const fine = new Date(NOON.getTime() + 30 * 60_000);
  assert.equal(scheduleProblem(fine, NOON), null);
});

test("a time is always in the future or absent", () => {
  // The one invariant that matters: a scheduled send must never be in the past,
  // because a past time runs the moment the cron next fires — which is "now",
  // which is the bug.
  for (const t of [
    "in 30min from now",
    "at 9am",
    "at 11pm",
    "tomorrow",
    "tonight",
    "on Friday",
    "next week",
    "at 6:30 pm tomorrow",
  ]) {
    const w = parseWhen(t, NOON);
    assert.ok(w, t);
    assert.ok(w!.at.getTime() > NOON.getTime(), `${t} → ${w!.at.toISOString()}`);
  }
});
