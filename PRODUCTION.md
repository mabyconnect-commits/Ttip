# Ttip — Going to Production

This is the one-stop checklist to take Ttip from sandbox to live money. Nothing
here changes code — production is a matter of provider accounts + environment
variables. The app runs identically in sandbox and live; the ledger, receipts,
and flows are the same. Live mode simply routes real money.

---

## 1. Money modes — the app fails *closed*

There are three states, and the default is **disabled** so a misconfigured
production deploy can never fake success (give away crypto, verify fake IDs):

| State | When | Behaviour |
|-------|------|-----------|
| **disabled** (default) | neither live nor demo | Buy, withdraw, and KYC endpoints **refuse** with a "not available yet" message. Nothing is faked. |
| **demo** | `DEMO_MODE=true` | Simulated money + instant KYC for testing. A visible **"Test mode — no real money moves"** banner appears on Buy / Send-out / KYC. |
| **live** | `SETTLEMENT_MODE=live` / `KYC_MODE=live` + provider keys | Real providers. Buys redirect to Paystack checkout; BVN/NIN checked via Dojah; payouts hit the bank. No banner. |

The switches:

| Variable | Values |
|----------|--------|
| `DEMO_MODE` | `true` to allow **simulated** money + KYC (test deployments only). Leave unset in production. |
| `SETTLEMENT_MODE` | `live` for real crypto/fiat movement (deposits, payouts, buys, withdrawals). |
| `KYC_MODE` | `live` for real BVN/NIN verification via Dojah. |

`DEMO_MODE` and the `*_MODE=live` switches are independent, but **live wins** — if
`SETTLEMENT_MODE=live`, real money moves regardless of `DEMO_MODE`. Recommended
go-live order: `KYC_MODE=live` first (enforce real identities), confirm, then
`SETTLEMENT_MODE=live`. Never ship to production with `DEMO_MODE=true`.

---

## 2. Accounts you need (on you — can't be coded)

1. **Postgres** database (`DATABASE_URL`). The build auto-creates tables.
2. **Dextopus** (crypto deposits) — live API key + webhook secret. Non-custodial,
   ~0.25%/tx, 70+ chains, settles to your Solana USDC treasury.
3. **Payout provider** for naira withdrawals — pick one, business account approved
   for **Transfers**: Paystack, Monnify, Flutterwave, or CoralPay. (Monnify has the
   cheapest published transfer tiers; Paystack is simplest to start.)
4. **Dojah** (KYC) — app id + secret key, with BVN/NIN lookup enabled.
5. **Collection provider** for buy-crypto — Paystack (card/bank checkout). Reuses
   the Paystack key.

---

## 3. Environment variables

### Core
```
DATABASE_URL=postgres://…
NEXT_PUBLIC_SHOW_DEMO=          # leave unset in prod to hide the deposit simulator
SETTLEMENT_MODE=live
KYC_MODE=live
```

### Crypto deposits — Dextopus
```
DEXTOPUS_API_KEY=…
DEXTOPUS_WEBHOOK_SECRET=…
DEXTOPUS_SETTLEMENT_CHAIN_ID=792703809          # Solana
DEXTOPUS_SETTLEMENT_ASSET=USDC
DEXTOPUS_SETTLEMENT_ADDRESS=<your Solana USDC treasury address>
DEXTOPUS_REFUND_TO=<optional default refund address>
```
Register the deposit webhook to `https://<your-domain>/api/webhooks/deposit`.
Set your per-VM default refund addresses in the Dextopus dashboard.

### Naira payouts + buy collections
```
PAYOUT_PROVIDER=paystack        # or monnify | flutterwave | coralpay
PAYSTACK_SECRET_KEY=sk_live_…
# Monnify (if used):
MONNIFY_API_KEY=…
MONNIFY_SECRET_KEY=…
MONNIFY_CONTRACT_CODE=…
MONNIFY_SOURCE_ACCOUNT=…
```
Register the provider webhook to `https://<your-domain>/api/webhooks/payout`.
This one URL handles **both** naira payouts (`transfer.*`) and buy-crypto
collections (`charge.*`).

### KYC — Dojah
```
DOJAH_APP_ID=…
DOJAH_SECRET_KEY=…
DOJAH_BASE_URL=https://api.dojah.io      # sandbox: https://sandbox.dojah.io
```

### Pricing (optional — competitive rates)
```
PLATFORM_MARGIN_PCT=0.015       # your spread (1.5%); revenue on every swap/buy/withdraw
P2P_PREMIUM_NGN=0.03            # track Bybit-P2P above official FX (+3%)
```

---

## 4. What each flow does in live mode

| Flow | Live behaviour |
|------|----------------|
| **Deposit** (crypto in) | User sends any crypto to their static address → Dextopus cross-chain settles to your Solana USDC treasury → webhook credits their naira. Works today. |
| **Withdraw → bank** | Debits crypto, sells into fiat float (auto-liquidating treasury if short), sends via your payout provider, reconciles on webhook, refunds on failure. |
| **Withdraw → wallet** (crypto out) | Debits atomically, queues a **pending** withdrawal for the treasury signer. Completes only when the signer broadcasts and `finalizeWithdrawal` is called with the tx hash. **Never** auto-marked sent. See §5. |
| **Buy crypto** (on-ramp) | Locks a buy quote (market + margin), collects fiat via Paystack checkout, credits crypto from treasury when `charge.success` arrives. |
| **KYC** | BVN/NIN verified against the government record; name must match. Withdrawals and buys are blocked until `kycStatus = verified`. |

---

## 5. The one remaining infra decision: the treasury signer

Crypto **withdrawal to an external wallet** is the only flow that needs signing
infrastructure — moving crypto off-platform requires a real on-chain transfer
signed from your treasury wallet. The app deliberately does **not** hold a hot
key in-process. In live mode a withdrawal is recorded as **pending** and waits
for your treasury signer to broadcast it and call `finalizeWithdrawal(reference,
"completed", txHash)`.

Options to fulfil it (pick one before enabling live crypto withdrawals):
- A managed signing service / MPC wallet (Fireblocks, Turnkey, Privy) driving a
  small worker that watches pending `withdrawal` settlements.
- A Dextopus outbound swap from treasury → the user's chain/asset/address.
- Manual ops signing for launch (low volume), automated later.

Until a signer is wired, keep the "To wallet" withdrawal disabled in live, or
process the pending queue manually. Naira withdrawals and buys need **no** signer.

---

## 6. Go-live checklist

- [ ] `DATABASE_URL` set; app deployed; tables created.
- [ ] `KYC_MODE=live` with Dojah keys; test one real BVN end-to-end.
- [ ] Dextopus live key + webhook registered; test a small real deposit.
- [ ] Payout provider business account approved for transfers; webhook registered;
      test a small real naira withdrawal.
- [ ] Paystack collection tested; buy a small amount of crypto end-to-end.
- [ ] Treasury signer decided for crypto-out (or "To wallet" disabled in live).
- [ ] `DEMO_MODE` unset (no simulated money/KYC) — confirm the Test-mode banner is gone.
- [ ] `NEXT_PUBLIC_SHOW_DEMO` unset (hide the deposit simulator).
- [ ] `PLATFORM_MARGIN_PCT` / `P2P_PREMIUM_*` tuned to your desired spread.
- [ ] Rotate any keys that were ever pasted outside your deployment env.
