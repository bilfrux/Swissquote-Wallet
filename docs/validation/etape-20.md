# Step 20: Crypto page in columns (Swissquote platform style), market prices and price charts

Request from the user (with a capture of the Swissquote trading platform): copy the bank's look more closely, and add price charts ("when I manage the Bitcoin account, I have the Bitcoin chart").

## Delivered

| Item | Location |
| --- | --- |
| **Market prices** (BTC and USDC in CHF, 24 h change, history) from CoinGecko, **served by Swissquote (bank-mock)** with a shared cache persisted on disk; last known value served if the API refuses | `bank-mock/src/market.ts`, routes `GET /market/prices`, `GET /market/history` |
| Client: prices shared by the whole app (refreshed every 5 min); **simulated rate** if the feed is unavailable, labelled as such | `client/src/lib/market.ts` |
| **Price chart** in the platform's style: green or red area depending on the period, last-price tag on the axis, axes, crosshair with price and date on hover, periods 1D 1W 1M 3M 1Y, source and "test coins have no value" under it | `client/src/ui/PriceChart.tsx` |
| Crypto page in **columns**: left, overview (total crypto value, daily change, number of assets) and **positions** (Bitcoin and USDC "self-custody · your keys", Bitcoin "held by Swissquote · custody"; value = quantity × market price; Send / Receive / Transfer buttons styled like the platform's Buy / Sell); middle, the selected asset with its chart; right, the action panel | `client/src/wallet/WalletHome.tsx`, `Account.tsx`, `Ethereum.tsx`, `index.css` |
| Home and footer: totals at market price, **USDC included**; "…" while the wallet is loading instead of "Create my wallet" | `client/src/App.tsx`, `bank/Overview.tsx`, `ui/Shell.tsx` |

## Verified before coding (not assumed)

- CoinGecko `/simple/price` and `/coins/{id}/market_chart` answer in CHF with an open CORS header (curl).
- **But** in the browser the calls failed: the public API rate-limits quickly (**429** observed, without CORS header, hence a "CORS" error in Chrome). A dev-server proxy did not help (same 429). Hence the feed in bank-mock with a cache shared by all browsers and tests.

## Defects found and fixed along the way (three were pre-existing)

| Defect | How it showed | Fix |
| --- | --- | --- |
| Two clients scanning the same bitcoind at once (bank-mock watches accounts every 30 s in regtest) → `Scan already in progress` 500 | `validate:6:ui` 6-11; very likely the **"unexplained 500"** noted in the handoff | the client waits for the other scan (`scantxoutset status`) and retries (`packages/bitcoin/src/backend.ts`) |
| The Ethereum page sent **~109 requests in 25 s** to the public Sepolia node | counted in the browser; exposure to rate limits | JSON-RPC requests batched (viem); chain time polled only around the recovery deadline: **12 requests** for the same page |
| bank-mock recorded the **old** owner after an Ethereum recovery | `validate:18` 18-4: chain owner `0x6a3d…`, Swissquote record `0xD639…` | owner read **at the finalisation block**, with retries (stale public node, as in step 16) |
| The Ethereum recovery panel was **re-created** a few seconds after the start and lost its progress | `validate:18`: "Complete the recovery" never appeared; panel back at step 1; mount timestamps showed only the panel was re-created (page and Ethereum view kept). Exact transient value not established (most likely a stale state read making the account momentarily "not active") | the panel no longer depends on that flag, and the **progress is kept in the session** (as the Bitcoin recovery): it survives a re-creation and a page reload (new criterion 18-6) |
| Home showed "Create my wallet" while the wallet was still loading | capture right after login | "…" until the wallet state is known |
| Name collisions in the interface (position buttons "Send", "Transfer to my wallet" identical to existing buttons) | `validate:6:ui` strict-mode errors | explicit accessible names ("Send BTC", "Receive USDC", "Open Swissquote account ↔ wallet transfers") |

## Results

| # | Criterion (`npm run validate:20`) | Verdict |
| --- | --- | --- |
| 20-1 | Price feed from bank-mock; second call served by the cache (same timestamp) | works |
| 20-2 | Positions: CHF value = quantity × market price (BTC 0.00008898 × 68,916 → 6.13; USDC 17 × 0.83045 → 14.12); self-custody separated from the Swissquote custody account | works |
| 20-3 | Bitcoin chart: 1W period loaded; crosshair with price and date on hover | works |
| 20-4 | "Send BTC" opens the Bitcoin send panel; "Receive USDC" switches to Ethereum and opens its receive panel | works |
| 20-5 | Same crypto total on the page and in the footer (BTC + USDC + custody) | works |
| 20-6 | Price feed cut (blocked in the browser): page still usable, "simulated rate" shown, message instead of the chart | works |
| 20-x | No console error | works (run 3) |

`validate:18` after the fixes: **18-1 to 18-6 work**, including 18-6 (progress survives a reload) and 18-4 (Swissquote's record = new owner `0x6045…`, same as on-chain).

**See "Last runs" below** for the console criterion (`-x`) and the rerun after the Bitcoin API rate limit.

## Last runs

- `validate:6:ui` after the scan fix: **19/19 desktop** (6-11 included, no more 500) and **20/20 phone** (6-8 now computed at market price). One phone run stopped once waiting for the fee presets (15 s); not reproduced on the rerun, cause not established.
- `validate:17`: 17-1 to 17-4 and 17-x work (1 USDC sent, `0x8024…9298`).
- `validate:19`: functional criteria work.
- Console criteria of `validate:18`, `19` and `20`: failed during the last runs with **429 from `blockstream.info`** only (identified by host in the tests). The hourly limit of the public Bitcoin signet API had been used up by the many test runs of the day. `validate:20` could not even load the Bitcoin balance in that state. To be rerun once the limit resets: see the addendum.
