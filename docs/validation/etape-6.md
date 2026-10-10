# Step 6: banking interface and Client Wallet

## Delivered

| Item | Location |
| --- | --- |
| **Client Wallet**: reference implementation of an external wallet (in production: hardware wallet or phone app). Single process (API + Vite interface as middleware), own storage `client-wallet/data/` (mode 600, ignored by git). `@scure/bip39` seed shown once; only the extended public key is transmitted; signs after a confirmation screen (path, outputs, amounts, fee); refuses the recovery path; API without CORS that refuses any other origin before execution; "Simulate losing this device" | `client-wallet/` (port 5180) |
| **Bank app**: simulated e-banking login, Overview (assets, Bitcoin tile), Accounts (fictitious CHF), crypto wallet (creation, balance, receive, send signed by the Client Wallet, coins and delay, security), recovery on its own screen, Demo · Attacks (regtest) | `client/src/` (`bank/`, `wallet/`, `recovery/`, `lib/walletBridge.ts`) |
| Bank ↔ wallet bridge: window + `postMessage`, origins checked on both sides | `client/src/lib/walletBridge.ts`, `client-wallet/src/ui/App.tsx` |
| bank-mock: login (`/auth/login`), profile and fictitious CHF accounts (`/me`), Bitcoin accounts of the logged-in client (`/wallet/accounts`), contact name | `bank-mock/src/bank.ts`, `server.ts`, `db.ts` |
| Guardian console: "Create my trusted-contact identity" (phrase shown once, public key) | `guardian-console/src/Console.tsx` |
| `npm run demo` also starts the Client Wallet | `package.json` |

Removed: `client/src/wallet/AccountSetup.tsx` (manual entry of the three keys), replaced by `CreateWallet.tsx`. It remains in git history (`779a5bd`).

## Commands

```bash
npm run regtest:up
npm run demo                                          # for the guardian console used by the test
CONSOLE_URL=http://localhost:5175 npm run validate:6:ui   # isolated stack: bank-mock :4110, wallet :5190, app :5191
npm run validate:inv5
npm run validate:1 && npm run validate:2 && npm run validate:3 && npm run test:attacks   # non-regression
npm run typecheck                                     # 7 projects
```

(`CONSOLE_URL`: port 5174 was taken on this machine by another process, the console took 5175. Since step 12, the test starts its own console on port 5192.)

## Results (`etape-6-ui-sortie.txt`)

| # | Criterion | Verdict |
| --- | --- | --- |
| 6-1 | Console: trusted-contact identity created, 24 words shown once then hidden, public key provided | works |
| 6-2 | Simulated e-banking login (wrong password refused), overview with CHF accounts and "Create my wallet" tile | works |
| 6-3 | Client Wallet: 24 words generated and shown once (identical to the stored seed); the bank receives the public key; policy stored in the wallet (delay 6, contact "Marie Dupont") | works |
| 6-4 | The client's phrase is neither in the app's storage nor page, nor in Swissquote's database; only the public key is at Swissquote | works |
| 6-5 | Receive: 0.5 BTC visible | works |
| 6-6 | Send: the refusal in the wallet reaches the app; confirmation screen ("your key alone", destination, 0.1 BTC, "change (this account)", fee); signed, broadcast, confirmed | works |
| 6-7 | From the bank's origin: reading the wallet API blocked (CORS); POST refused before execution (403 "origin rejected") | works |
| 6-8 | Overview: Bitcoin tile with balance and CHF value (simulated rate) | works |
| 6-9 | Wallet loss (erased from the Client Wallet), then recovery from a new profile: re-KYC, new wallet created by the Client Wallet, Swissquote + contact (console), **real `non-BIP68-final` refusal before D**, success at D, new wallet active with the funds | works |
| 6-10 | "Demo · Attacks" tab with the three scenarios | works |
| 6-11 | No error in the browser consoles, apart from the two deliberate refusals of the test (wrong password in 6-2, forbidden call in 6-7) | works |
| 6-12 | The Client Wallet refuses to sign a recovery PSBT, even when called directly (400 "recovery path") | works |
| Inv. 5 | 19 machine seeds (including the Client Wallet's) and their account private keys absent from `client/` and the bundle; positive control 18/18 files | works (`etape-6-invariant-5-sortie.txt`) |
| Regressions | `validate:1` 6/6, `validate:2` 8/8, `validate:3` 3/3, `test:attacks` 4/4; typing of the 7 projects | works (`etape-6-regressions-sortie.txt`) |

Screenshots: `captures/etape-6-*.png` (login, overview, wallet phrase, wallet, confirmation screen, send, recovery refusal before D, new wallet).

## Defects found by the test and fixed

- **Race between scans** (app): when switching to the new wallet after recovery, a stale scan of the old account overwrote the balance with 0. Fix: the view is remounted on each account change, and only the response of the last scan is taken into account.
- **Wallet erasure** (Client Wallet): DELETE was refused (415) by the "simple request" guard, and the error was not displayed. Fix: guard limited to POSTs (a DELETE from another origin requires a CORS preflight, which fails), and error displayed.
- **Hot reload**: two wallet instances fought over Vite's HMR port. Fix: HMR goes through the wallet's HTTP server.

## Limits

- The reference Client Wallet stores the seed **in clear** (file in mode 600), without PIN or encryption (fixed at step 8). In production: hardware wallet or phone app with a secure element.
- In the demo, a single Client Wallet process serves both "devices": the old wallet is erased before the new one is created.
- The Chrome tests of steps 1 to 4 targeted the previous interface: their npm commands are removed, the files remain for history.
- Client CH-0001 of the `bank-mock/data` demo database holds 12 regtest accounts created by earlier tests; the step 6 test uses an isolated stack and client CH-0002 (later CH-0003).

## Follow-up: Swissquote-style interface, desktop and phone

From the two reference screenshots supplied by the team (Swissquote web platform and mobile app):

| Item | Desktop | Phone (< 820 px) |
| --- | --- | --- |
| Navigation | White header (brand, Home / Banking / Crypto / Demo menu with red underline, account, red "Log out"), red icon rail on the left, status bar at the bottom | Round buttons at the top, tab bar at the bottom (active tab in red) |
| Home | "Overview": figures banner, Accounts / Crypto / Recent transactions rows, performance chart with period selector | Centred total value, card with amount, flag, change, chart, 1W…All selector, 2×2 tiles (Accounts, Crypto, Cash, Savings), round buttons (Receive, Send, Transactions) |
| Crypto | Banner (balance, counter-value, next recovery opening), Receive / Security / Coins / Send cards | Centred balance, round buttons (Receive, Send, Security), stacked cards |

Logo: **official Swissquote logo supplied by the team**, cropped and made transparent (`client/public/swissquote-logo.png`, round mark alone for the tab icon: `swissquote-mark.png`); accent colour aligned with the logo (`#fe5e3a`). Figures in Swiss format (`36’309.84`). The day's change and the home curve are **simulated** and labelled as such. The Client Wallet keeps its own style. The guardian console now has its own stylesheet (`guardian-console/src/console.css`).

| Check | Command | Verdict |
| --- | --- | --- |
| Full journey, desktop layout (1280×1000) | `CONSOLE_URL=http://localhost:5175 npm run validate:6:ui` | works, 12/12 (`etape-6-ui-sortie.txt`) |
| Full journey, phone layout (390×844, touch) | `MOBILE=1 CONSOLE_URL=http://localhost:5175 npm run validate:6:ui` | works, 12/12 (`etape-6-ui-mobile-sortie.txt`) |
| Invariant 5 after the redesign | `npm run validate:inv5` | works |
| Typing of the 7 projects | `npm run typecheck` | works |

Screenshots: `captures/etape-6-desktop-*.png` and `captures/etape-6-mobile-*.png`. The screenshots `captures/etape-6-[1-8]-*.png` show the interface before the redesign.
