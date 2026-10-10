# Step 2: bank-mock (Swissquote guardian) and guardian console (trusted contact)

## Delivered

| Item | Location | Role |
| --- | --- | --- |
| bank-mock | `bank-mock/src/` (port 4000, storage `bank-mock/data/`: SQLite + seed in mode 600, ignored by git) | **Mocked** Swissquote guardian, separate process |
| Guardian console | `guardian-console/` (port 5174, separate app) | The contact reads the request in plain language, enters their phrase, signs; nothing is stored |
| Client app | `client/src/lib/bank.ts`, `AccountSetup.tsx`, `App.tsx` | Fetches Swissquote's public key and registers the account. Optional: the app works without bank-mock |

### bank-mock endpoints

| Route | Effect |
| --- | --- |
| `GET /guardian/key?network=` | Swissquote **public** account key (the seed never leaves) |
| `POST /accounts/register` | Registers an account (client key, contact key, delay) for a client of the simulated bank |
| `POST /identity/verify` | **Mocked** re-KYC: one test file per client; returns a token valid for 10 min |
| `POST /guardian/sign` | Signs a PSBT **only if**: valid KYC token; all inputs spend a script of an account registered to that client (the scriptPubKey is recomputed); recovery path (nSequence = D); all outputs go to **another** registered account of the **same** client. Each decision is logged (`sign_log`) |

These checks are an extra layer. The real guarantee, two signatures and the delay D, is enforced by Bitcoin consensus (see test 6).

## Commands

```bash
npm run regtest:up
npm run validate:2        # starts its own bank-mock (port 4100, storage .local/bm-test), then stops it at test 7
npm run dev               # client (5173), bank-mock (4000), console (5174)
npm run validate:2:ui     # headless Chrome; CONSOLE_URL / APP_URL if the default ports are taken
```

## Results (`etape-2-sortie.txt`, `etape-2-ui-sortie.txt`)

| # | Criterion | Verdict |
| --- | --- | --- |
| 1 | Swissquote key generated at first launch, in bank-mock's storage (mode 600); only the public key is exposed | works |
| 2 | Account registration; unknown client refused (403) | works |
| 3 | **Unverified identity refused** by `/guardian/sign` (no token, invented token); wrong OTP code refused | works |
| 4 | After re-KYC: Swissquote signs the A → B recovery of the same client, with its own key (checked on the signature) | works |
| 5 | Refusals: ordinary spend (client path), recovery to a foreign address, another client's coins | works |
| 6 | The contact signs (console code); the combined PSBT is rejected by the node before D (`non-BIP68-final`) and accepted at D | works (preview of step 3) |
| 7 | **bank-mock stopped**: `/guardian/sign` unreachable (`ECONNREFUSED`), and **the client spends alone** (external signature, broadcast) | works |
| 8 | **No key in `client/`**: 0 extended private keys, Swissquote seed absent, no signing or seed import, no BIP39 list in the bundle | works |
| UI-1 | Console: the displayed public key matches the phrase; the phrase field is cleared | works |
| UI-2 | Console: an ordinary spend is flagged ("NOT a recovery") and the sign button is disabled | works |
| UI-3 | Console: the recovery is decoded (delay, destination) then signed with the contact's key | works |
| UI-4 | Console: phrase absent from localStorage, sessionStorage, the DOM and fields after signing | works |
| UI-5 | App: Swissquote key obtained from bank-mock, account created then registered | works |
| UI-6 | No error in the browser consoles | works |

Key-search command of test 8:

```bash
grep -rlE '[tx]prv[1-9A-HJ-NP-Za-km-z]{100,}' client/src client/dist
grep -rlF "<Swissquote seed>" client/src client/dist
grep -rlE '@sq/bitcoin/(sign|keys)|mnemonicToSeed|swissquote-seed|bank-mock/data' client/src
grep -rl '"abandon","ability"' client/dist
```

Screenshots: `captures/etape-2-console-guardian.png`, `captures/etape-2-appli-enregistree.png`.

## Accepted limits

- **Mocked** re-KYC: two hard-coded test files (`bank-mock/src/kyc.ts`). The token is reusable for 10 min.
- The bank session is mocked: the client is identified by `VITE_CUSTOMER_ID`, without authentication (later replaced, see step 6).
- `node:sqlite` is flagged experimental in Node 24 (warning hidden at launch).
- The guardian console runs in a browser: the phrase transits in memory for the time of signing. A real contact would use their own wallet.
- Address ownership proof (optional) was not done at this step (see step 7).
