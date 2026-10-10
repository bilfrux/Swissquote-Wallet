# Step 11 (A2): Swissquote account ↔ wallet transfers, with automatic ownership proof (Travel Rule)

Track idea: move from crypto held in custody by Swissquote (today's offer) to self-custody, without copy-pasting addresses and under the Travel Rule (self-hosted wallet: Swissquote must establish that the wallet belongs to its client).

## Delivered

| Item | Location |
| --- | --- |
| Swissquote **custodial** crypto account: MOCKED holdings ledger (demo balances: CH-0001 1.5 BTC, CH-0002 0.4 BTC, CH-0003 0.8 BTC) | `bank-mock/src/custody.ts` (`custody_ledger`) |
| Swissquote **real** omnibus wallet in bitcoind (regtest), created and funded by demo mining; unrelated to the guardian key | `custody.ts` (`omnibus`) |
| Withdrawal to the wallet: only to an address of an account registered to the client (403 otherwise), **and only after a verified ownership proof** for that address (412 otherwise); Travel Rule record (originator, beneficiary, proof reference) | `custody.ts` (`withdraw`), routes `POST /custody/withdraw`, `GET /ownership/status`, `GET /custody/travel-rule` |
| Deposit to Swissquote: client deposit address; credited only if **all** inputs come from a wallet registered to the client, otherwise "awaiting verification", not credited | `custody.ts` (`depositAddress`, `syncDeposits`) |
| Interface: account "Transfer" button; the ownership proof is requested **automatically** from the Client Wallet (PIN) when the address has none yet; "Prepare a deposit" pre-fills the send to the deposit address; Travel Rule list; Swissquote crypto account on the home page | `client/src/wallet/Transfer.tsx`, `lib/ownership.ts`, `lib/bank.ts`, `wallet/Account.tsx`, `bank/Overview.tsx` |

## Commands and results

```
npm run regtest:up
npm run validate:11
CONSOLE_URL=http://localhost:5175 npm run validate:6:ui
MOBILE=1 CONSOLE_URL=http://localhost:5175 npm run validate:6:ui
```

| # | Criterion | Verdict |
| --- | --- | --- |
| 11-1 | Withdrawal without proof: 412 "Travel Rule: proof of ownership required"; to a foreign address: 403 | works (`etape-11-sortie.txt`) |
| 11-2 | After verified proof (BIP-322, `bip322-js`): 0.3 BTC sent on-chain by the omnibus, received in the wallet, Swissquote balance debited | works |
| 11-3 | Travel Rule record: originator and beneficiary (same person, self-hosted wallet), proof reference | works |
| 11-4 | Withdrawal above holdings: 400 | works |
| 11-5 | Deposit from the wallet: credited; deposit from an unknown source: held, not credited | works |
| 11-6 | Signet: explicit refusal (501), the signet omnibus is not funded | works |
| 6-19 | Chrome: "Transfer" 0.1 BTC → proof signed in the Client Wallet with the PIN → send → Travel Rule line displayed | works (desktop and phone: `etape-11-ui-ordinateur-sortie.txt`, `etape-11-ui-telephone-sortie.txt`) |
| Full journey | `validate:6:ui`: 18/18 on desktop, 19/19 on phone | works |
| Non-regression | `validate:1`, `2`, `3`, `7`, `8:pin`, `8:alerts`, `10`, `11`, `test:attacks`, `validate:inv5`; typing of the 7 projects | works (`etape-11-regressions-sortie.txt`) |
| — | Deposit from the interface (button "Prepare a deposit" then "Check my deposits") | **not tested in Chrome** (logic tested in 11-5) |

## What was observed along the way

- First version: the app attempted the withdrawal, received 412, then did the proof. The journey worked, but the browser console showed the 412 error. Now the app first asks `GET /ownership/status` and only does the proof if needed. The 412 remains the server-side safeguard (11-1).
- One desktop run showed once an unidentified **500 error** (the console did not give the URL). I did not reproduce it in 5 later runs (3 on desktop, 2 on phone). The test now records the method, URL and response of any 5xx error to diagnose it if it comes back. **Cause not established.**

## Limits

- Regtest only: on signet, the omnibus is not funded (explicit 501 refusal).
- Mocked holdings ledger; the omnibus is funded by demo mining.
- The proof covers possession of the client key at the address index (see step 7), not a signature of the P2WSH address itself.
- The deposit source check is simple: all inputs must come from an address (lookahead 50) of a registered account of the client. No chain analysis or sanctions screening (mock planned for the EVM part).
- The Travel Rule record is local. No transmission to another provider (unnecessary here: the beneficiary is a self-hosted wallet of the same client).
