import "server-only";
import { prisma } from "../db";
import { listDeposits } from "./dextopus";
import { parseDextopusDeposit } from "./webhook";
import { scaleDepositAmount } from "./deposit-amount";
import { creditDeposit } from "./index";

/**
 * Ask Dextopus what actually landed, instead of waiting to be told.
 *
 * THE structural fix. Every other money flow in this app already polls — bills,
 * buys, crypto withdrawals, bank payouts all have a reconciler that asks the
 * provider directly, because a webhook is a promise and not a guarantee.
 * Deposits alone had a single delivery path. One dropped request, one rejected
 * signature, one unregistered URL, and the money settled into treasury while
 * the app never learned it existed. That is every "it reached the treasury but
 * never showed up" report in one sentence.
 *
 * Now a missed webhook costs a few minutes rather than the deposit.
 *
 * Safe to run repeatedly: creditDeposit is keyed on the provider's own id and a
 * replay hits the unique constraint, so a deposit cannot credit twice however
 * often this runs or how many webhooks arrive alongside it.
 */

export interface DepositReconcileResult {
  usersChecked: number;
  seen: number;
  credited: number;
  skipped: number;
  /**
   * Why the ones that weren't credited weren't credited, counted by reason.
   *
   * "seen 5, credited 0" is a fact without a cause, and chasing that cause
   * through production logs is what turned a one-line bug into weeks. Every
   * `continue` in the loop below now names itself here.
   *
   * Deliberately free of user data — no ids, no addresses, no amounts — because
   * this is read from an endpoint that is not always behind a session.
   */
  why: Record<string, number>;
}

export async function reconcileDeposits(limitUsers = 25, onlyUserId?: string): Promise<DepositReconcileResult> {
  const result: DepositReconcileResult = { usersChecked: 0, seen: 0, credited: 0, skipped: 0, why: {} };
  const note = (reason: string) => {
    const key = reason.slice(0, 300);
    result.why[key] = (result.why[key] ?? 0) + 1;
  };

  // Users who actually have a Dextopus address — nobody else can have deposited.
  const rows = onlyUserId ? [{ userId: onlyUserId }] : await nextUsersToPoll(limitUsers);

  for (const { userId } of rows) {
    result.usersChecked++;
    // Stamped BEFORE the call, not after: a user whose provider request throws
    // must still move to the back of the queue, or one failing account blocks
    // the rotation for everybody behind it.
    if (!onlyUserId) {
      await prisma.walletAddress
        .updateMany({ where: { userId, provider: "dextopus" }, data: { polledAt: new Date() } })
        .catch(() => {});
    }
    const records = await listDeposits({ userId }).catch(() => []);

    for (const record of records) {
      result.seen++;

      // Reuse the webhook parser so the poller and the webhook can never
      // disagree about what a payload means.
      // An address with nothing in it yet is not a failure.
      //
      // `GET /deposit/static/deposits` returns a row for every deposit address
      // we have ever generated, carrying `originAmount: "0"` until something
      // actually arrives — including the placeholder bc1qqqq…mql8k8. Ten of
      // those hit the parser, which correctly refused a zero amount, and the
      // poller filed all ten under "skipped": a count that reads exactly like
      // ten lost deposits and is nothing of the sort.
      //
      // Recognise them for what they are, so "skipped" means something is
      // wrong again.
      const hasAmount = [
        record.settlementAmount, record.settlementAmountFormatted,
        record.originAmount, record.originAmountFormatted,
        record.amountIn, record.amountOut, record.amount,
      ].some((v) => v !== undefined && v !== null && Number(v) > 0);
      if (!hasAmount) {
        note("empty-slot: deposit address with nothing received yet");
        continue;
      }

      let deposit;
      try {
        deposit = parseDextopusDeposit({ data: record, event: undefined });
      } catch (e) {
        result.skipped++;
        // The parser's own words, plus the keys the record actually had. A
        // REST record whose shape differs from the webhook's is invisible
        // otherwise — it just throws and is counted as "skipped".
        note(`parse-failed: ${(e as Error).message.slice(0, 240)}`);
        continue;
      }
      if (deposit.status !== "confirmed") {
        // The provider's own status word, verbatim. If it is one we simply
        // don't recognise as success, this single line says so.
        const raw = String((record as Record<string, unknown>).status ?? "").slice(0, 24);
        note(`not-confirmed: provider status="${raw}"`);
        continue;
      }

      // Already CREDITED? A row that is merely pending must still be finished —
      // skipping on "a row exists" is how a deposit recorded as pending would
      // sit there for ever.
      const existing = await prisma.settlement.findUnique({
        where: { externalId: deposit.externalId },
        select: { id: true, status: true, createdAt: true },
      });
      if (existing && !canRetry(existing)) {
        note(`already-recorded: status="${existing.status}"`);
        continue;
      }
      if (existing) {
        // Clear the placeholder so creditDeposit's own idempotency guard can
        // write the real completed row.
        await prisma.settlement.delete({ where: { id: existing.id } }).catch(() => {});
      }

      // Base units → tokens, exactly as the webhook does.
      const scaled = await scaleDepositAmount(deposit);
      if (!scaled.deposit) {
        console.error("[deposit] poller could not scale", deposit.externalId, scaled.reason);
        result.skipped++;
        note(`scale-failed: ${scaled.reason ?? "unknown"}`);
        continue;
      }

      // Dextopus echoes our userId, but fall back to the one we polled for.
      const credit = await creditDeposit({ ...scaled.deposit, userId: scaled.deposit.userId ?? userId }).catch(
        (e) => {
          console.error("[deposit] poller credit failed", deposit.externalId, e);
          return { credited: false, userId: null, reason: "threw" };
        },
      );
      if (credit.credited) {
        result.credited++;
      } else {
        result.skipped++;
        note(`credit-refused: ${credit.reason ?? "no reason given"}`);
      }
    }
  }

  return result;
}

/**
 * Deposits held before this moment are the manual backlog. Leave them alone.
 *
 * "review" means the deposit was real but we couldn't name its asset, so it was
 * parked for a human. Retrying those automatically would be right — except that
 * some of the old ones were already paid out by hand from the balance desk, and
 * there is no flag on the row saying so. Crediting one of those a second time
 * hands the user free money with nothing to show it was a duplicate.
 *
 * So the backlog stays manual (Clean-up → Held only → pick → Credit), and
 * anything held from here on is retried automatically. Nothing that arrives
 * from now on can get permanently stuck, and nothing already settled by hand
 * can be paid twice.
 */
const AUTO_RETRY_HELD_AFTER = new Date("2026-08-14T00:00:00Z");

/**
 * Can the poller have another go at a row it has already written?
 *
 * "pending" always: it is a placeholder we wrote ourselves, meaning the provider
 * hadn't confirmed yet. "review" only for deposits newer than the backlog
 * cutoff. Anything else — completed, settled_manually — is finished, and
 * touching it is how a deposit gets paid twice.
 */
function canRetry(row: { status: string; createdAt: Date }): boolean {
  if (row.status === "pending") return true;
  return row.status === "review" && row.createdAt >= AUTO_RETRY_HELD_AFTER;
}

/**
 * The next batch to ask about: never-polled first, then oldest-polled.
 *
 * A brand-new depositor is the most likely person to be waiting on a deposit
 * right now, so they jump the queue; after that it is strict round-robin, which
 * is the only ordering under which every user is guaranteed to be checked.
 *
 * Deduplicated here rather than with `distinct`, because Postgres DISTINCT ON
 * demands the distinct column lead the ORDER BY, and the ordering is the whole
 * point of this query.
 */
async function nextUsersToPoll(limitUsers: number): Promise<{ userId: string }[]> {
  const take = Math.max(1, Math.min(limitUsers, 200));
  const seen = new Set<string>();
  const out: { userId: string }[] = [];

  const add = (found: { userId: string }[]) => {
    for (const row of found) {
      if (seen.has(row.userId)) continue;
      seen.add(row.userId);
      out.push(row);
      if (out.length >= take) return true;
    }
    return false;
  };

  // A user can hold several addresses, so over-fetch and let the dedupe decide.
  const fresh = await prisma.walletAddress.findMany({
    where: { provider: "dextopus", polledAt: null },
    select: { userId: true },
    orderBy: { id: "desc" },
    take: take * 4,
  });
  if (add(fresh)) return out;

  const stale = await prisma.walletAddress.findMany({
    where: { provider: "dextopus", polledAt: { not: null } },
    select: { userId: true },
    orderBy: { polledAt: "asc" },
    take: take * 4,
  });
  add(stale);
  return out;
}
