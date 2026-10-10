# Step 3: Bitcoin recovery, refusal before D, refresh (gate B)

## Delivered

| Item | Location |
| --- | --- |
| "Recover my account" screen: re-KYC, old account found, new key, request signed by Swissquote, contact's signature, broadcast with the real network error, switch to the new account. State (public data) is kept while waiting for D | `client/src/recovery/Recovery.tsx` |
| "Soon spendable by Swissquote + trusted contact" warning and refresh button | `client/src/wallet/Account.tsx`, `Send.tsx` (since step 1) |
| `POST /accounts/list` (after re-KYC): public keys of the client's accounts, for a new device | `bank-mock/src/server.ts` |
| "your new account" label in the recovery simulation | `client/src/simulation/PsbtSummary.tsx` |
| Common validation tools | `scripts/validate/lib.ts` |

## Commands

```bash
npm run regtest:up
npm run validate:3                                    # regtest: dedicated bank-mock (port 4101)
npm run dev                                           # client, bank-mock (4000), console
npm run validate:3:ui                                 # headless Chrome, 3 profiles (CONSOLE_URL / APP_URL if needed)
npm run validate:3:signet -- prepare | broadcast      # real recovery on signet, bank-mock on 4000
```

## Regtest results (`etape-3-sortie.txt`)

| # | Criterion | Verdict |
| --- | --- | --- |
| 1 | Swissquote + contact recovery on two coins received 2 blocks apart: **rejected by consensus** (`non-BIP68-final`) at 1 conf, then as long as the newest coin has fewer than D conf; **accepted at D**; funds on the new account, old account empty | works |
| 2 | Refresh: warning displayed at D−2; after the send-to-self, the already signed recovery is rejected (`missing-inputs`), and a new recovery on the refreshed coin is rejected (`non-BIP68-final`): the delay restarts from zero | works |
| 3 | Meanwhile, the client spends alone from 1 confirmation, with Swissquote stopped | works |

## Browser results (`etape-3-ui-sortie.txt`, screenshots `etape-3-*.png`)

| # | Criterion | Verdict |
| --- | --- | --- |
| UI-1 | Old device: warning when the delay approaches | works |
| UI-2 | New device (other profile): re-KYC, old account found, new key registered, request signed by Swissquote | works |
| UI-3 | Trusted contact (third profile): signs in the guardian console | works |
| UI-4 | Broadcast before D: the app shows the real network refusal (`non-BIP68-final`) and the number of remaining blocks | works |
| UI-5 | At D: recovery broadcast; the new account opens with the funds | works |
| UI-6 | Old device: empty account | works |
| UI-7 | No error in the browser consoles | works |

## Signet (`etape-3-signet-sortie.txt`)

Coin from step 1 (859 sats, `9203045e…d248:0`, confirmed at block 325781) on account #7. Recovery to account #8 (new client key), signed by Swissquote **through the real bank-mock** (port 4000, its own key), after re-KYC, and by the trusted contact.

| Criterion | Verdict |
| --- | --- |
| Broadcast at 1 confirmation: **rejected by the signet network** (`sendrawtransaction RPC error -26: non-BIP68-final`) | works |
| Broadcast at 6 confirmations (block 325786): **accepted by the signet network**: 859 sats spent through the Swissquote + contact path, 700 sats to the new account #8 (`tb1qv37a3kg6dna8zd252paegjfejrvepsp4cagaeg5kj54y7dvqfw4qyn4xqp`), 159 sats of fee | works |

Real recovery transaction: [d26b94de30f36cbfa8b1a7f39976bf74a09e7afafda09b7a66a916b37326c519](https://blockstream.info/signet/tx/d26b94de30f36cbfa8b1a7f39976bf74a09e7afafda09b7a66a916b37326c519). Observed: broadcast accepted by the Esplora API. Block confirmation was not checked at the time of writing.
