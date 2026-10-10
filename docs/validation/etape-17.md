# Step 17: Ethereum account in the product (Sepolia, no ETH)

One Client Wallet, one secret phrase, two accounts: Bitcoin (unchanged) and Ethereum. The Ethereum account is a Safe owned by the client's EOA, with Candide's recovery module (Swissquote + trusted contact, threshold 2, 3-minute demo instance). Fees are paid by Candide's public paymaster (a third party, not Swissquote).

## Delivered

| Item | Location |
| --- | --- |
| Shared package, **no key**: Safe address, sponsored operations (abstractionkit), state read at a given block, plain-language decoding of an operation (single call or MultiSend batch; USDC transfer/approve with unlimited-approval flag; module and guardian calls; anything else flagged "not decoded") | `packages/evm/src/index.ts` |
| EVM key derivation `m/44'/60'/0'/0/0` (viem); imported only by the Client Wallet, bank-mock and the console, never by `client/` | `packages/evm/src/keys.ts` |
| Client Wallet: Ethereum address derived from the same phrase (stored as public data; PIN needed once for older wallets); confirmation screen that decodes the operation **itself**; refuses to sign any call it cannot explain | `client-wallet/src/server.ts` (`/api/wallets/:id/evm`, `/api/evm/describe`, `/api/evm/sign`), `ui/App.tsx` (`EvmAddress`, `EvmSign`) |
| bank-mock: Swissquote's EVM guardian address (derived from its own seed); EVM account registration (Safe address **recomputed** by Swissquote from the owner; the contact must be a third party) | `bank-mock/src/guardian.ts`, `db.ts` (`evm_accounts`), `server.ts` (`/guardian/evm-address`, `/evm/accounts`, `/evm/accounts/register`) |
| Guardian console: the contact's Ethereum address, from the same phrase | `guardian-console/src/Console.tsx` |
| App: "Ethereum · USDC" card: add account, activate (deploy + module + 2 guardians), USDC balance, send USDC, cancel a pending recovery. Two clicks (prepare, then sign) so the wallet window opens on a user gesture | `client/src/wallet/Ethereum.tsx`, `CryptoTab.tsx`, `lib/bank.ts`, `lib/walletBridge.ts` |
| Signet demo on free ports | `scripts/demo/signet-ports.sh` (`npm run demo:signet:ports`) |

## Command

```bash
npm run demo:signet:ports                 # app 5183, console 5184, Client Wallet 5180, bank-mock 4000
APP_URL=http://localhost:5183 CONSOLE_URL=http://localhost:5184 npm run validate:17
```

## Results (`etape-17-sortie.txt`, captures `etape-17-*.png`)

| # | Criterion | Verdict |
| --- | --- | --- |
| 17-1 | Add the Ethereum account: address derived in the Client Wallet, contact's address read in their console, Safe recomputed by Swissquote and shown; registration without a session refused (401) | works: Safe `0x292919c03fe12BEAD122998d1280812eeD5723AA`, owner `0xB33e…E891` |
| 17-2 | Activation from the interface: the Client Wallet screen lists "Enable the recovery module (Candide, 3 minutes delay)", the two guardians and "paid by a sponsor"; Safe deployed with guardians Swissquote + contact, threshold 2, 0 ETH | works: [tx 0xd943…7eca](https://sepolia.etherscan.io/tx/0xd943777d7bc9fcceba6c586d7047e96e3f82f3ea84091c9f66f22d2e18617eca) in run 2; state read on-chain afterwards: owner = client EOA, guardians `0x8243…86Ee` (contact) and `0xd2D6…ca17` (Swissquote), threshold 2, module enabled (see below) |
| 17-3 | The Client Wallet refuses to sign an operation with a call it cannot decode | works: `400 refused: not decoded: do not sign unless you know what it does` |
| 17-4 | Send 1 USDC from the interface, signed in the Client Wallet, fees sponsored | **not tested yet**: waiting for test USDC from Circle's faucet on the Safe address above |
| 17-x | No error in the browser consoles | works (run 3) |

## The three runs

| Run | Result | Cause and fix |
| --- | --- | --- |
| 1 | 17-1 OK, then timeout waiting for the wallet window | The app prepared the operation (bundler + paymaster round trips) **then** opened the wallet window: no longer a user gesture, so the browser blocked it. Fix: two clicks, "Activate" (prepare) then "Sign with my Client Wallet", as in the Bitcoin send flow. |
| 2 | Activation sent and included; 17-2 marked KO; React "duplicate key" errors | The test read the state "latest" on the public node right after inclusion (stale, as in step 16). A read a moment later showed the expected state. The duplicate key was mine: the Ethereum card had the same React key as its sibling Bitcoin card. Fixes: test reads at the receipt's block; distinct key. |
| 3 | 17-1, 17-3, 17-x OK; 17-2 "already activated" | Activation is a one-time on-chain action, so run 3 could not repeat it. The 17-2 verdict rests on run 2's transaction, its capture (`etape-17-1-activation-wallet.png`) and the on-chain read recorded in `etape-17-sortie.txt`. |

## Non-regression (`etape-17-regressions-sortie.txt`)

Typing of the 8 projects; `validate:1, 2, 3, 7, 8:pin, 8:alerts, 9, 10, 11, 12, inv5`, `test:attacks`; full journey `validate:6:ui` 19/19 on desktop and 20/20 on phone. One failure along the way, **9-6** (signet history of CH-0003): the test read the signet wallet currently in the Client Wallet, which since step 8 is the **new** wallet created by the recovery. The test now reads the original wallet (public key kept in the test state). It shows the faucet reception, the send of step 8 and the outgoing recovery.

## Limits

- The guardians' EVM recovery from the interface is step 18 (the contract path was proven in step 16, by script).
- Public sponsorship policy: Candide's, its abuse limits are unknown to us. A private policy would let Swissquote set its own rules (or pay for them).
- 3-minute demo instance; target value 7 or 14 days (existing module instances).
- Module v0.0.1: pitfalls of step 0 still apply (guardian removal does not cancel a recovery; call `invalidateNonce` after a cancellation, which the "Cancel this recovery" button does).
