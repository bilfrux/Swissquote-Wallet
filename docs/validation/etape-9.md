# Step 9: transaction history and fee estimation

## Delivered

| Item | Location |
| --- | --- |
| `ChainBackend.history()` and `feeRates()`: Esplora (signet) through `/address/:a/txs` and `/fee-estimates`; bitcoind (regtest) through a **watch-only** wallet created once per account with its **public** descriptors (no private key), `listsinceblock` (with `include_change`, otherwise refreshes are hidden) and `getrawtransaction` (spent outputs are re-read for mempool transactions), `estimatesmartfee` | `packages/bitcoin/src/backend.ts` |
| `history(cfg, backend)`: each transaction classified from the account's point of view ("received", "received by recovery", "sent", "refresh", "outgoing recovery" if nSequence = D), net amount and fee | `packages/bitcoin/src/wallet.ts` |
| Fees: rate in sat/vB, fractions accepted (fee rounded up to the satoshi), never below 1 sat/vB (relay minimum; the signet API sometimes announces 0.1) | `backend.ts`, `wallet.ts` |
| "History" card (table on desktop, list on phone, explorer link on signet); Economy / Normal / Fast fee presets with the estimate's source, "Normal" by default, free field kept | `client/src/wallet/Account.tsx`, `Send.tsx` |

## Results

| # | Criterion | Verdict |
| --- | --- | --- |
| 9-1 | regtest: two receives (+0.3 and +0.2), one send (−0.1, exact fee), one refresh (0, fee), one pending outgoing recovery (top of the list) | works |
| 9-2 | On the new account side, the same recovery appears as "received by recovery" | works |
| 9-3 | Fractional rate (3.5 sat/vB): integer fee | works |
| 9-4 | Regtest fees: node estimate (or defaults), all ≥ 1 sat/vB | works |
| 9-5 | **Real signet** fees (Esplora API), floored at 1 sat/vB | works |
| 9-6 | **Real signet** history of wallet CH-0003: receive of 10,000 sats from the faucet | works |
| 6-16 | Interface (desktop and phone): fee presets displayed; history "Received +0.5 BTC" and "Sent −0.1 BTC" | works |
| Full journey | `validate:6:ui`: 15/15 on desktop, 16/16 on phone | works |
| Non-regression | `validate:1` to `validate:8:alerts`, `test:attacks`, `validate:inv5`; typing of the 7 projects | works (`etape-9-regressions-sortie.txt`) |

Defects found and fixed along the way: `listtransactions` hid refreshes; in mempool, bitcoind does not give spent outputs; the existence check of the watch-only wallet caused 500 errors (replaced by `listwalletdir`, and initialization is serialized).

Limits: history limited to the first 20 addresses of each chain (like the scan) and, on Esplora, to the last 25 transactions per address. No acceleration of a stuck transaction (RBF).

## Follow-up: redesign of the Crypto tab and the Client Wallet

- **Crypto tab**: asset page modelled on the Swissquote platform. On the left, Bitcoin header (balance, counter-value, recovery status pill), round actions (Receive, Send, Refresh) and History / Coins / Security sub-tabs. On the right, an action panel in the manner of "New order": Receive by default, with **QR code** (`qrcode` 1.5.4 library), copy, new address and ownership proof; or Send / Refresh. On phone, everything is stacked. History as a list with icons (received, sent, internal).
- **Client Wallet**: same visual language as the app (light background, cards, typography, buttons), own identity (key icon, "Independent of Swissquote", reference-implementation mention). Confirmation screen with the amount sent in large type, the recipient and the fee, then the details.
- Full journey revalidated: 15/15 on desktop, 16/16 on phone.

## Rate limit of the public Esplora API (signet)

blockstream.info limits the free API to **700 requests per hour per IP**. The limit was reached (`429 Too Many Requests`), mainly by bank-mock's signet watching (40 addresses × 3 accounts every 5 min). Fixes:

| Fix | Effect |
| --- | --- |
| Address discovery by **gap limit** (stop after 5 consecutive never-used addresses, per chain) when the backend knows whether an address was used | fewer addresses queried |
| 20 s **cache** of per-address reads (scan and history share requests); UTXOs requested only for used addresses | no duplicate requests |
| bank-mock signet watching every **15 min** (instead of 5) | ÷ 3 |

Offline measurement (`npm run validate:9:budget`, fake API counting calls): **15 requests** per refresh (scan + history) instead of about 80 (`etape-9-budget-sortie.txt`).

During the blocking window, signet checks 9-5 and 9-6 failed with `429`: **not tested** after the fix, to be rerun once the limit is lifted (later rerun: they pass). Regtest checks 9-1 to 9-4 pass. For intensive signet demos: an own Esplora instance or a blockstream API key (`VITE_ESPLORA_URL`, `ESPLORA_URL`).
