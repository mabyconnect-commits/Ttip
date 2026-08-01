# Ttip — Crypto in. Cash out. Tip anyone.

A full-stack web app for swapping crypto (BTC, ETH, USDT, …) to African fiat (Naira,
Cedis, Shillings, Rand) and tipping friends instantly. Mobile-first PWA plus a desktop
web dashboard, built from the original Ttip UI design.

Built with **Next.js 14 (App Router) · TypeScript · Tailwind · Prisma · PostgreSQL**.

---

## What's inside

**Frontend — every screen from the design, wired to a real backend:**

- Onboarding / landing, sign-up & sign-in
- Home — live balance, rates ticker, quick actions, your assets
- Swap — crypto → fiat with live rates, free-swap allowance, bank payout
- Ttip — send money to any @user (or tip link) with a note, emoji & streaks
- Feed — social tips, reactions, weekly Ttip League leaderboard
- Card — virtual USD card, fund-from-crypto, freeze, rewards & points
- Bills — airtime, data, electricity, TV, betting, internet (paid from crypto)
- Add money (deposit) — per-network addresses + QR, incoming-deposit simulator
- Send out — to bank or external wallet
- Split a bill — settle a group tab instantly
- Referrals — invite links, QR, earnings
- Profile — public tip link (`/u/username`) + QR, recent tippers, settings
- Web dashboard (`/dashboard`) — sidebar, balance chart, activity, league

**Backend — real persistence and a working money engine:**

- Email/username + password auth with bcrypt hashing and signed JWT session cookies
- A double-entry-style wallet ledger: every swap, tip, bill, deposit and withdrawal
  moves balances inside a database transaction with overdraft protection
- Live crypto prices from CoinGecko (cached), with a static fallback so the app never
  breaks if the feed is unavailable
- Cross-asset conversion (any crypto ⇄ any supported fiat) via a USD pivot
- REST API under `/api/*` (auth, wallet, prices, swap, send, deposit, bills, card,
  feed, referrals, contacts, transactions, split, profile)

---

## Run locally

Prerequisites: **Node 18+** and a **PostgreSQL** database.

```bash
# 1. install
npm install

# 2. configure env
cp .env.example .env
#   then edit .env — set DATABASE_URL and a long random AUTH_SECRET
#   generate a secret with:  openssl rand -base64 48

# 3. create tables + demo data
npm run db:push
npm run db:seed

# 4. start
npm run dev
```

Open http://localhost:3000.

### Checks

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # next lint
npm test            # unit tests for the money engine (node:test)
```

These same checks plus a production build run automatically in CI
(`.github/workflows/ci.yml`) on every push and pull request.

**Demo account:** `kola@ttip.money` / `password123`
(other seeded users: `amara`, `tobi`, `zuri` — all `password123`)

---

## Deploy to Vercel

1. Push this repo to GitHub and **Import** it in Vercel.
2. **Add a database.** In the Vercel project, open the **Storage** tab → **Create
   Database** → **Postgres** (or use a free [Neon](https://neon.tech) project). When you
   create Vercel Postgres it auto-adds `DATABASE_URL` to your project for you.
3. In **Settings → Environment Variables**, make sure these are set:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Postgres connection string (auto-added by Vercel Postgres) |
   | `AUTH_SECRET` | a long random string — run `openssl rand -base64 48` |
   | `NEXT_PUBLIC_APP_URL` | your production URL, e.g. `https://your-app.vercel.app` |
   | `COINGECKO_API_KEY` | *(optional)* CoinGecko demo/pro key for higher rate limits |

4. **Redeploy.** That's it — the build automatically creates the database tables and
   seeds the demo account. No manual migration or seed step is needed.

**Verify it worked:** open `https://your-app.vercel.app/api/health`. You want to see
`"database":"connected"`, `"tables":"ready"`, `"AUTH_SECRET":true`, `"demoSeeded":true`.
If any of those are off, the JSON tells you exactly what to fix. The sign-in / sign-up
screens also now show the real reason instead of a generic error.

> **Important:** the app needs a database to work. If you deploy without adding one, the
> app still loads but sign-in/sign-up will report that the database isn't configured —
> add Postgres (step 2), set `AUTH_SECRET`, and redeploy.

### Mobile apps (iOS & Android)

The app is a installable **PWA** (manifest + standalone display), so users can "Add to
Home Screen" today. To ship to the App Store / Play Store, wrap this same web app with
[Capacitor](https://capacitorjs.com/) — point it at your deployed URL (or bundle the
static shell) and submit. No rewrite needed; the UI is already mobile-first.

---

## Settlement — crypto in, naira out

The real-money rails live behind one provider-agnostic layer (`src/lib/settlement/`)
so the app runs identically whether money is simulated or live:

- **`SETTLEMENT_MODE=sandbox`** (default) — no external money moves. Crypto
  deposits are credited by the in-app simulator or a signed webhook; naira
  payouts settle instantly. The ledger, balances and receipts behave exactly as
  in production, so the whole **deposit → withdraw** loop is demoable today.
- **`SETTLEMENT_MODE=live`** — real crypto deposits arrive via the provider
  webhook and real naira payouts go out through Flutterwave.

**How the loop works**

1. **Crypto in.** A deposit provider watches each user's addresses and, when
   funds land and are swept into treasury, POSTs `/api/webhooks/deposit`
   (HMAC-signed with `DEPOSIT_WEBHOOK_SECRET`). `creditDeposit()` credits the
   user's balance — **idempotently**, keyed on the provider's `externalId`, so a
   replayed webhook can never double-credit.
2. **Naira out.** On a bank withdrawal the crypto is debited and a `pending`
   payout is recorded atomically, then `payoutFiat()` calls the provider. A
   terminal result settles immediately; a `pending` one is finalised later by
   `/api/webhooks/payout`. **Failed payouts auto-refund** the debited crypto.

Every movement is recorded in the `Settlement` table (unique `externalId`) for a
clean audit trail.

**Payout providers.** Four are built in — **Paystack, Flutterwave, Monnify,
CoralPay** — behind one interface; `PAYOUT_PROVIDER` (or whichever keys are
present) picks which sends fiat, so you can run the cheapest per function. Payout
webhooks land on `/api/webhooks/payout`, distinguished and verified by their own
signature header.

**Crypto deposits.** **Dextopus** (cross-chain, 70+ networks, non-custodial,
~0.25%/tx) is wired as the deposit provider — it issues static addresses and posts
to `/api/webhooks/deposit`, verified with its own secret. Any other provider
(Blockradar, NOWPayments…) is one new file behind the same interface.

**Treasury, float & liquidity.** Swept deposits accrue in a `TreasuryBalance`
crypto pot; payouts draw from the fiat float. When a payout exceeds the float,
`ensureFloat()` **auto-sells treasury crypto into the float at the live rate**, so
a large withdrawal still goes out immediately even on a thin float — the core
exchange liquidity trick. The liquidity venue is provider-agnostic (sandbox now;
an exchange/OTC/P2P desk plugs in later).

**Competitive pricing.** `src/lib/pricing.ts` quotes users the live market/P2P
reference rate **minus a thin margin** (`PLATFORM_MARGIN_PCT`, default 1.5%), so
Ttip tracks Bybit P2P automatically; the spread is captured as revenue.

**Currencies.** Naira plus 8 more African currencies (GHS, KES, ZAR, XOF, XAF,
UGX, TZS, RWF, ZMW, EGP, MAD, ETB), all priced live off the USD pivot.

> **On cost:** naira *payouts* are a small flat/capped fee per transfer on both
> Paystack and Flutterwave — not a percentage. (The ~1.4% percentage fee is on
> card/bank *collections*, which this flow doesn't use.)

See `.env.example` for the keys each provider needs.

## Security hardening

Baked in and applied on every deploy:

- **Security headers** on all routes (`next.config.mjs`) — a locked-down
  Content-Security-Policy, HSTS (2y, preload), `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, a strict `Referrer-Policy` and
  `Permissions-Policy`. `X-Powered-By` is disabled.
- **Rate limiting** on the sensitive endpoints (`src/lib/rate-limit.ts`):
  sign-in (10 / 5 min per IP), sign-up (5 / hr per IP) and PIN unlock
  (5 / min per user) to blunt credential stuffing and PIN brute-force. It is an
  in-process limiter — on serverless it applies per warm instance; swap the map
  for Upstash/Redis for a cluster-wide guarantee (the `rateLimit()` signature
  stays the same).
- **Required `AUTH_SECRET`** — sessions refuse to sign/verify without a
  ≥16-char secret; there is no insecure fallback.
- **Dependencies** kept on a patched Next.js 14.2.x line.

## Honest note on "production-ready"

The **software** here is production-grade: real auth, a real database, a real transaction
ledger, live pricing, input validation, security headers, rate limiting, a unit-tested
money engine, CI, and a Vercel-ready build.

What a real-money launch additionally requires — and what no code alone can provide — is
the **regulated financial plumbing**:

- **Custody & on-chain settlement** — a wallet/custody provider (Fireblocks, BitGo,
  Circle) to actually hold crypto and broadcast transactions. Deposit addresses here are
  generated for the flow; the "simulate incoming" button credits balances for demo/testing.
- **Fiat payouts** — a licensed local partner/PSP (e.g. Flutterwave, Paystack, or a bank)
  to move Naira/Cedis/etc. to real bank accounts.
- **FX / liquidity** — a rate provider or OTC desk for firm quotes. This build uses
  CoinGecko reference prices plus indicative fiat rates in `src/lib/constants.ts`.
- **Card issuing** — a card-issuer partner (e.g. Marqeta, Sudo) for real virtual cards.
- **KYC/AML & licensing** — identity verification and the money-transmitter / VASP
  licenses required in each market.

Every place that touches the outside world is isolated behind small modules
(`src/lib/prices.ts`, the deposit/send/card/bills routes) so you can swap the simulated
settlement for a licensed provider without touching the UI.

---

## Project layout

```
prisma/schema.prisma      data model (User, Balance, Transaction, Card, FeedItem, …)
prisma/seed.ts            demo users + activity
src/lib/                  db, auth, prices, wallet ledger, constants, formatting
src/app/api/              REST endpoints
src/app/(app)/            authenticated mobile screens (shared shell + tab bar)
src/app/dashboard/        desktop web dashboard
src/app/u/[username]/     public tip link
src/components/           shared UI (buttons, sheets, tab bar, QR, receipts, …)
src/context/AppContext    client state, optimistic updates, toasts
```
