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

**Demo account:** `kola@ttip.money` / `password123`
(other seeded users: `amara`, `tobi`, `zuri` — all `password123`)

---

## Deploy to Vercel

1. Push this repo to GitHub and **Import** it in Vercel.
2. Create a database — **Vercel Postgres** (Storage tab) or a free **Neon** project — and
   copy its connection string.
3. In the Vercel project **Settings → Environment Variables**, add:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | your Postgres connection string |
   | `AUTH_SECRET` | a long random string (`openssl rand -base64 48`) |
   | `NEXT_PUBLIC_APP_URL` | your production URL, e.g. `https://ttip.vercel.app` |
   | `COINGECKO_API_KEY` | *(optional)* CoinGecko demo/pro key for higher rate limits |

4. **Deploy.** The build runs `prisma generate` automatically.
5. After the first deploy, create the tables and seed once. Easiest is locally with the
   production `DATABASE_URL` exported:

   ```bash
   DATABASE_URL="<your prod url>" npm run db:push
   DATABASE_URL="<your prod url>" npm run db:seed   # optional demo data
   ```

That's it — the app is live.

### Mobile apps (iOS & Android)

The app is a installable **PWA** (manifest + standalone display), so users can "Add to
Home Screen" today. To ship to the App Store / Play Store, wrap this same web app with
[Capacitor](https://capacitorjs.com/) — point it at your deployed URL (or bundle the
static shell) and submit. No rewrite needed; the UI is already mobile-first.

---

## Honest note on "production-ready"

The **software** here is production-grade: real auth, a real database, a real transaction
ledger, live pricing, input validation, and a Vercel-ready build.

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
