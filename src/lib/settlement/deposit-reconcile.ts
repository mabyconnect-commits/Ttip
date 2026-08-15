import "server-only";
import { prisma } from "../db";
import { listDeposits, listDepositsDetailed } from "./dextopus";
import { parseDextopusDeposit } from "./webhook";
import { scaleDepositAmount, scaleUnits } from "./deposit-amount";
import { creditDeposit } from "./index";
import { verifyAcrossChains, findIncomingOnChain } from "./onchain-verify";
import { couldBeAddress } from "./asset-resolve";
import type { NormalizedDeposit } from "./types";

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
    const listed = await listDepositsDetailed({ userId }).catch((e) => ({
      records: [] as Record<string, unknown>[],
      error: `threw: ${(e as Error).message.slice(0, 50)}`,
    }));
    if (listed.error) note(`provider-error: ${listed.error}`);
    const records: Record<string, unknown>[] = listed.records;

    // Ask by ADDRESS as well, never only by user id.
    //
    // Every question we put to Dextopus has been "what did user X deposit?",
    // which silently assumes they echo our user id back on every record. If one
    // record is missing that id — a chain where it isn't propagated, a sweep
    // credited to the address alone — that deposit is invisible to us for ever,
    // however often we poll. The address is the thing we actually know: we
    // issued it, we showed it to the user, they sent money to it.
    //
    // So the addresses are asked about too, and anything only they return is
    // merged in. Deduplicated on the provider's own id, and the credit path is
    // idempotent regardless, so a deposit that comes back on both routes is
    // still credited exactly once.
    const addresses = await prisma.walletAddress.findMany({
      where: { userId, provider: "dextopus" },
      select: { address: true },
    });
    const seenIds = new Set(records.map((r) => String(r.requestId ?? r.depositId ?? r.id ?? "")));
    for (const { address } of addresses) {
      if (!address) continue;
      const extra = await listDeposits({ depositAddress: address }).catch(() => []);
      for (const rec of extra) {
        const id = String(rec.requestId ?? rec.depositId ?? rec.id ?? "");
        if (id && seenIds.has(id)) continue;
        if (id) seenIds.add(id);
        note("found-by-address-only: absent from the user's own deposit list");
        records.push(rec);
      }
    }

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
        const statusText = raw.toUpperCase().trim();
        // How LONG it has been unconfirmed is the whole question.
        //
        // A deposit PENDING for two minutes is the system working. The same
        // deposit PENDING for six hours is the provider stuck, and the user is
        // told "it's confirming" while nothing is confirming. Those need
        // completely different responses from us and read identically without
        // an age.
        const at = (record as Record<string, unknown>).createdAt;
        const started = at ? new Date(String(at)).getTime() : NaN;
        const ageH = Number.isFinite(started) ? (Date.now() - started) / 3_600_000 : NaN;
        const age = !Number.isFinite(ageH)
          ? "age unknown"
          : ageH < 1 ? "under 1h"
          : ageH < 6 ? "1-6h"
          : ageH < 24 ? "6-24h"
          : `${Math.floor(ageH / 24)}d+ STUCK`;
        note(`not-confirmed: provider status="${raw}" (${age})`);

        // WRITE IT DOWN ANYWAY. A deposit sitting at PENDING on the provider's
        // side is real money already sent by a real person, and until now the
        // poller returned here having recorded nothing: no settlement, no trace,
        // nothing for an admin to point at. The user sees an empty wallet and
        // reports "I deposited and nothing happened" — and we had no way to
        // answer, because the only honest answer, "it is confirming", existed
        // nowhere in our database.
        //
        // creditDeposit's own unconfirmed path records it as pending and credits
        // nothing, so this cannot pay anyone early. Scale first so the pending
        // row shows tokens rather than base units.
        const held = await scaleDepositAmount(deposit);
        if (held.deposit) {
          await creditDeposit({ ...held.deposit, userId: held.deposit.userId ?? userId }).catch(() => null);
        }

        // STUCK? Then stop asking the provider and ask the chain.
        //
        // Production had a deposit sitting at PENDING for over four days. That
        // is not a confirmation delay — Solana settles in seconds — it is the
        // provider's pipeline stuck, and while their flag is our only truth the
        // user is told their money doesn't exist. The chain is the better
        // witness and it is free to ask.
        //
        // Only past the grace period, so the normal path is untouched: a deposit
        // that confirms in seconds never reaches this code.
        if (Number.isFinite(ageH) && ageH * 60 >= stuckAfterMinutes() && statusText !== "REFUNDED") {
          const rescued = await rescueStuckDeposit(deposit, userId, record, started);
          note(`stuck-rescue: ${rescued.note}`);
          if (rescued.credited) result.credited++;
        }
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
 * How long a deposit may sit unconfirmed before we go and check the chain.
 *
 * Long enough that the ordinary path is completely untouched — Dextopus
 * normally confirms in seconds — and short enough that a stuck deposit is a
 * nuisance rather than a support ticket. Tunable without a deploy.
 */
function stuckAfterMinutes(): number {
  const raw = Number((process.env.DEPOSIT_STUCK_AFTER_MINUTES ?? "").trim());
  return Number.isFinite(raw) && raw > 0 ? raw : 20;
}

/**
 * Credit a stuck deposit on the blockchain's word instead of the provider's.
 *
 * The safety here is the whole point, so it is worth being explicit about what
 * makes this safe to do automatically:
 *
 *  - The chain is asked whether THIS transaction moved THIS token into THIS
 *    address. Nothing in the provider's payload can influence the answer.
 *  - The amount credited is the amount the chain reports, not the amount the
 *    provider claimed. A wrong number in their record cannot become a balance.
 *  - REFUNDED is excluded by the caller: money that was sent back must never be
 *    credited, however well confirmed the original transfer was.
 *  - creditDeposit stays idempotent on the provider's own id, so when Dextopus
 *    finally does confirm, that later credit is a no-op rather than a second
 *    payment.
 *
 * If any of that can't be established, it credits nothing and says why.
 */
async function rescueStuckDeposit(
  deposit: NormalizedDeposit,
  userId: string,
  record: Record<string, unknown>,
  createdAtMs?: number,
): Promise<{ credited: boolean; note: string }> {
  // ASK OUR OWN LEDGER FIRST.
  //
  // The very first stuck deposit this rescued turned out to be already paid —
  // the user had the money all along and only Dextopus's record still said
  // PENDING. Checking the chain before checking ourselves spent a dozen RPC
  // calls a minute to answer a question our own database could answer for free,
  // and reported a settled deposit as a failure the whole time.
  const blocking = await prisma.settlement.findUnique({
    where: { externalId: deposit.externalId },
    select: { status: true, createdAt: true },
  });
  if (blocking?.status === "completed") {
    return { credited: false, note: "already credited — nothing owed" };
  }
  if (blocking && !canRetry(blocking)) {
    return { credited: false, note: `blocked by an existing "${blocking.status}" row` };
  }

  const txHash = String(record.originTxHash ?? record.txHash ?? "").trim();
  if (!txHash) return { credited: false, note: "no origin tx hash to check" };

  // The provider's record carries no chain, but we issued the address — so our
  // own table knows which network it belongs to.
  const addr = deposit.address
    ? await prisma.walletAddress.findFirst({
        where: { address: deposit.address, provider: "dextopus" },
        select: { network: true, symbol: true },
      })
    : null;
  // Our own label is a hint, not the answer — the hash decides which chains to
  // ask, and the preferred one is simply tried first.
  const preferred = networkId(addr?.network) ?? undefined;

  // A token contract/mint, or undefined for the chain's own coin.
  const asset = (deposit.asset ?? "").trim();
  const token = couldBeAddress(asset) ? asset : undefined;

  let check = await verifyAcrossChains({ txHash, address: deposit.address, token, preferred });
  let signature: string | undefined;

  // THE HASH IS THEIRS; THE ADDRESS IS OURS.
  //
  // Production said, of a stuck Solana deposit: the address IS in that
  // transaction and its balance did NOT increase. That is not a failed
  // deposit — `originTxHash` is Dextopus's own SWEEP, money moving OUT, so we
  // had been verifying the wrong transaction entirely. Their hash describes
  // their bookkeeping, not the user's payment.
  //
  // So when their hash proves nothing, stop using it and ask the address for
  // its own history. The deposit address is the one fact here that has never
  // been in doubt: we issued it, and we showed it to the user.
  if (!check.verified && preferred === "sol") {
    const found = await findIncomingOnChain({
      network: "sol",
      address: deposit.address,
      // A deposit record claims one payment; don't reach back before it existed.
      notBefore: createdAtMs ? createdAtMs - 6 * 3_600_000 : undefined,
    });
    if (found.verified) {
      check = found;
      signature = found.signature;
    }
  }

  if (!check.verified) return { credited: false, note: `chain says no: ${check.reason ?? "unverified"}` };

  // Never pay the same on-chain transfer twice.
  //
  // externalId stops one provider record crediting twice. It cannot see two
  // DIFFERENT records both pointing at the same transfer — which is exactly
  // what a history scan can produce, since it isn't anchored to their id.
  if (signature) {
    const already = await prisma.settlement.findFirst({
      where: { reference: signature },
      select: { id: true },
    });
    if (already) return { credited: false, note: "that on-chain transfer is already credited" };
  }

  // Credit the CHAIN's amount AND the chain's asset, in base units, scaled by
  // that token's own decimals. Where the provider's record disagrees with the
  // log, the log is what actually happened.
  //
  // The chain's decimals win when it gave them. A chain's own coin appears in no
  // provider catalogue, so asking Dextopus to scale a native deposit fails —
  // the deposit would be proven and then held as unscalable, which is the same
  // uncredited money by a different route.
  const base = {
    ...deposit,
    reference: signature,
    asset: check.asset ?? deposit.asset,
    status: "confirmed" as const,
    amountIsRaw: true,
    rawAmount: check.rawAmount,
    amount: Number(check.rawAmount ?? 0),
  };
  let scaled: NormalizedDeposit | undefined;
  if (check.decimals != null) {
    const amount = scaleUnits(check.rawAmount ?? "", check.decimals);
    if (amount != null) scaled = { ...base, amount, amountIsRaw: false };
  }
  if (!scaled) {
    const fallback = await scaleDepositAmount(base);
    if (!fallback.deposit) return { credited: false, note: `verified but unscalable: ${fallback.reason ?? "?"}` };
    scaled = fallback.deposit;
  }

  // What, exactly, is holding this externalId?
  //
  // Deleting only `pending` rows wasn't enough — production still answered
  // "verified but not credited: duplicate" afterwards, so the row in the way is
  // some other status and the bare word "duplicate" never said which. The three
  // cases need three different answers and only one of them is a problem:
  //
  //   completed — the user HAS the money. Nothing is owed. Not an error, and
  //               the row must stay exactly where it is.
  //   pending   — our own placeholder. Clear it and pay.
  //   review    — held because we couldn't name the asset. The chain has now
  //               named it, so clear it and pay — but only inside the same
  //               backlog cutoff the poller uses, because older held rows may
  //               already have been paid by hand from the balance desk and
  //               carry no flag saying so.
  // The placeholder was already judged safe to replace at the top of this
  // function; clear it so the credit below isn't refused as a duplicate.
  await prisma.settlement.delete({ where: { externalId: deposit.externalId } }).catch(() => {});

  const credit = await creditDeposit({
    ...scaled,
    userId: scaled.userId ?? userId,
  }).catch((e) => ({ credited: false, userId: null, reason: `threw: ${(e as Error).message.slice(0, 40)}` }));

  return credit.credited
    ? { credited: true, note: "CREDITED from on-chain proof" }
    : { credited: false, note: `verified but not credited: ${credit.reason ?? "?"}` };
}

/** Our stored network label → the id the RPC map is keyed by. */
function networkId(network: string | null | undefined): string | null {
  const n = (network ?? "").trim().toLowerCase();
  if (!n) return null;
  if (n.includes("sol")) return "sol";
  if (n.includes("trc") || n.includes("tron")) return "trc20";
  if (n.includes("bep") || n.includes("bnb") || n.includes("bsc")) return "bep20";
  if (n.includes("erc") || n.includes("ethereum")) return "erc20";
  if (n.includes("base")) return "base";
  if (n.includes("arb")) return "arb";
  if (n.includes("optimism") || n === "op") return "op";
  if (n.includes("poly") || n.includes("matic")) return "poly";
  if (n.includes("avax") || n.includes("avalanche")) return "avax";
  return null;
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
