# Step 7: ownership proof and blank demo client

## Prior check (requested before coding)

| Item | Executed proof | Result |
| --- | --- | --- |
| 3-button attack panel | Chrome on the demo stack: count and execution of button 2 | 3 buttons; no. 2 returns "⛔ Rejected (as expected)", `non-BIP68-final` |
| Invariant 1 | `npm run test:attacks` | 4/4 as expected; Swissquote alone rejected on both paths after D |
| Invariant 5 | `npm run validate:inv5` | 4/4 checks, with positive control |
| README, threat model, architecture diagram | files present; 2 Mermaid diagrams rendered | present, rendering OK |

## Delivered

| Item | Location |
| --- | --- |
| Challenge and verification (single use, 10 min; key recomputed from the registered xpub; `Verifier.verifySignature(…, strict = true)`) | `bank-mock/src/server.ts` (`/ownership/challenge`, `/ownership/verify`), table `ownership_challenges` |
| Challenge signature after a confirmation screen showing the full message (BIP-322 "simple", `Signer.sign`) | `client-wallet/src/server.ts` (`/api/prove`), `client-wallet/src/ui/App.tsx` |
| "Prove to Swissquote that I control this address" button, with the exact wording of what is proved | `client/src/wallet/Account.tsx` |
| P2WPKH address of the client key (public key only) | `packages/bitcoin/src/ownership.ts` |
| Blank client `CH-0003` (Léa Martin, `demo0003`; re-KYC `Martin` / `1992-03-21` / `246810`) | `bank-mock/src/bank.ts`, `kyc.ts` |
| Fix: very long texts (addresses) widened the page on phone | `client/src/index.css` |

Library: `bip322-js` 4.0.0, installed only in `client-wallet`, `bank-mock` and at the root (tests). It is not in the app.

## What is proved

- **Proved**: the client holds the private key of their client key at index i (BIP-322 signature verified for the P2WPKH address of that key). According to the registered policy, that key alone is enough to spend address #i of the account (client path).
- **Not proved**: this is not a signature of the account's P2WSH address itself (not handled by `bip322-js`); the key → address link relies on the descriptor known to Swissquote. Nothing about the identity of the person: it is tied to the client through the bank session.

## Commands and results

```bash
npm run validate:7                                                   # etape-7-sortie.txt
CONSOLE_URL=http://localhost:5175 npm run validate:6:ui              # etape-6-ui-sortie.txt
MOBILE=1 CONSOLE_URL=http://localhost:5175 npm run validate:6:ui     # etape-6-ui-mobile-sortie.txt
```

| # | Criterion | Verdict |
| --- | --- | --- |
| 7-1 | CH-0003: login, 2 CHF accounts, **0 Bitcoin accounts** (also checked on the demo stack, on regtest and signet) | works |
| 7-2 | Valid proof for address #3: challenge, Client Wallet signature, strict verification | works |
| 7-3 | Replay of an already used challenge: 409 | works |
| 7-4 | Signature of a message different from the challenge: refused | works |
| 7-5 | Signature of the right challenge by another key: refused | works |
| 7-6 | Right key but old BIP-137 format: refused (strict mode) | works |
| 7-7 | Challenge requested by another client for this account: 403 | works |
| 7-8 | The Client Wallet refuses an account that is not on the device: 404 | works |
| 6-13 | In the interface, on desktop and phone: challenge displayed in full in the wallet, signed, "Ownership verified" | works |
| 6-14 | Phone: no page wider than the screen (390 px) | works |
| Full journey | `validate:6:ui` on CH-0003: 13/13 on desktop, 14/14 on phone | works |
| Non-regression | `validate:1` 6/6, `validate:2` 8/8, `validate:3` 3/3, `test:attacks` 4/4, `validate:inv5` 4/4, typing of the 7 projects | works (`etape-7-regressions-sortie.txt`) |
