# Step 8: signet interface, Client Wallet PIN, alerts

## No. 1: the interface on the real signet network

`npm run demo:signet` starts the app, the console and the Client Wallet on signet (reading and broadcasting through the blockstream.info Esplora API). Test: `npm run validate:8:signet -- create | spend | recover` (headless Chrome; test state in `.local/signet-ui/`, ignored by git).

| # | Criterion | Verdict |
| --- | --- | --- |
| 8-1 | Signet, interface: wallet CH-0003 created through the Client Wallet, balance read on signet, address `tb1qsd8naqffu8q4460kjvwd3nmu4svzw5tmg3xdv06q0nh6zeyl2xuq9m06j6` | works (`etape-8-signet-create-sortie.txt`) |
| 8-2 | Signet, interface: ownership proof verified by Swissquote | works |
| 8-3 | Signet, interface: send signed in the Client Wallet, broadcast, visible on the explorer | **not tested**: waiting for signet BTC on the address above (faucet) |
| 8-4 | Signet, interface: Swissquote + contact recovery from a new device | **not tested**: after 8-3 and 6 confirmations |

This signet wallet was created before the PIN was added: it is "not protected" (seed in clear), which the Client Wallet flags.

## No. 2: Client Wallet PIN

Seed encrypted at rest: `scrypt` (N = 32768, r = 8, p = 1) then AES-256-GCM, with `node:crypto` (OpenSSL). PIN of 6 to 12 digits, chosen at creation, requested on the signing and proof screens. 60 s lockout after 5 wrong PINs. For an old wallet in clear: "Protect with a PIN". Files: `client-wallet/src/vault.ts`, `server.ts`, `store.ts`, `ui/App.tsx`.

| # | Criterion (`npm run validate:8:pin`, isolated wallet) | Verdict |
| --- | --- | --- |
| 8-5 | Creation without a PIN: refused | works |
| 8-6 | Neither the phrase, nor any pair of its words, nor any word in the encrypted part is written to disk; the right PIN gives the phrase back | works (stable over 3 runs) |
| 8-7 | Signing with a wrong or missing PIN: refused, remaining attempts shown | works |
| 8-8 | Signing with the right PIN: signed PSBT | works |
| 8-9 | After 5 wrong PINs: lockout, even the right PIN is refused (429) | works |
| 8-10 | Old wallet in clear: flagged "not protected", then encrypted; the phrase in clear disappears from disk | works |

Limit: protects use, not file theft followed by an offline exhaustive search of a 6-digit PIN. Test fix along the way: the first version searched each isolated word in the whole file, and "label" or "wallet" (BIP39 words present in the file structure) gave false positives.

## No. 3: client alerts

bank-mock watches the accounts (regtest every 30 s, signet every 5 min, or on demand with `POST /alerts/run`) and creates alerts: coin at ≤ ⌈D/3⌉ blocks from opening, recovery open, and **immediately** when Swissquote signs a recovery. They appear in a bell (header on desktop, round button on phone) and go out by simulated email (`outbox.log`). Files: `bank-mock/src/alerts.ts`, `server.ts`, `client/src/ui/NotificationBell.tsx`.

| # | Criterion (`npm run validate:8:alerts`, isolated bank-mock) | Verdict |
| --- | --- | --- |
| 8-11 | 1 confirmation (recovery in 5 blocks): no alert | works |
| 8-12 | Recovery in 2 blocks: "soon" alert, no duplicate on the next pass | works |
| 8-13 | Recovery open: "open" alert | works |
| 8-14 | Swissquote signs a recovery: immediate alert "Swissquote signed a recovery request" | works |
| 8-15 | Each alert also goes out by simulated email | works |
| 8-16 | Alerts marked read; another client does not see them | works |
| 6-15 | In the interface, on desktop and phone: the **old device** sees the bell light up as soon as Swissquote signs the recovery | works |

Limit: information only. They depend on Swissquote, and the email is simulated.

## Non-regression

Full journey `validate:6:ui` (with PIN and alerts): 14/14 on desktop, 15/15 on phone. `validate:1` 6/6, `validate:2` 8/8, `validate:3` 3/3, `test:attacks` 4/4, `validate:inv5` 4/4, `validate:7` 8/8; typing of the 7 projects (`etape-8-regressions-sortie.txt`).
