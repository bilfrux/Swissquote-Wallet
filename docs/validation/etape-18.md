# Step 18: Ethereum recovery from the interface (Sepolia, no ETH)

Same story as the Bitcoin recovery, enforced by Candide's recovery module instead of Bitcoin consensus: Swissquote and the trusted contact must **both** sign; the contract then waits (3 minutes, demo instance) before the new key becomes owner; the current owner can cancel in the meantime (button "Cancel this recovery", step 17).

## Delivered

| Item | Location |
| --- | --- |
| Swissquote's EIP-712 signature of a recovery request, **only** after re-KYC, for a Safe of the verified client, to a key that is neither the current owner nor a guardian; logged; alert to the client | `bank-mock/src/server.ts` (`POST /guardian/evm/sign-recovery`) |
| Relay to the contact (A3) for Ethereum requests: the returned signature is **verified** by Swissquote against the contact's registered address for this Safe and this request | `bank-mock/src/server.ts` (`POST /relay/signed`) |
| Owner synchronised from the chain after a recovery | `POST /evm/accounts/sync` |
| Contact's console: Ethereum request shown in clear (account, new key, delay, cancellation), checks on-chain that the contact's key is a guardian of this account, signs (EIP-712, viem), sends back | `guardian-console/src/Console.tsx` (`EvmRecovery`) |
| App: "Lost the key of this Ethereum account? Recover it": re-KYC → new Client Wallet → its Ethereum address → Swissquote's signature → link for the contact → fetch their signature → start (relayed by the new key's own Safe, sponsored) → countdown → complete → invalidate leftover guardian signatures (project rule) | `client/src/wallet/Ethereum.tsx` |
| Client Wallet: the owner of an existing Safe is read **on-chain** (after a recovery, it is no longer the key that created the Safe) | `client-wallet/src/server.ts` (`describeEvm`) |
| `@sq/evm`: operations on an explicit Safe address; owners read on-chain; state read at a block with retries | `packages/evm/src/index.ts` |

## Command

```bash
npm run demo:signet:ports
APP_URL=http://localhost:5183 CONSOLE_URL=http://localhost:5184 npm run validate:18     # about 6 minutes
```

## Results (run 8, `etape-18-sortie.txt`, captures `etape-18-*.png`)

| # | Criterion | Verdict |
| --- | --- | --- |
| 18-1 | Swissquote refuses to sign without re-KYC, and refuses a recovery to the current owner | works: `403 identity not verified` ; `403 the new owner must be a new key of the client` |
| 18-2 | Request sent to the contact through the relay; their console shows the new key and signs; Swissquote checks it is the registered contact's signature | works |
| 18-3 | Recovery started from the interface (Swissquote + contact), relayed and sponsored; delay shown; owner unchanged during the delay | works: [tx 0x5586…3734](https://sepolia.etherscan.io/tx/0x5586fb5e0b0c8580087df031ecae70416fc39cdc7eb8f24f042c0549345e3734) |
| 18-4 | After the delay: recovery completed from the interface; owner = new key; Swissquote's record updated | works: [tx 0x988c…c0bc](https://sepolia.etherscan.io/tx/0x988c75c2411ec1ac8fa8e6fe193569fd881d361d6cde3571739370aa5e49c0bc), owner `0x0855…F82a` |
| 18-5 | The new key signs from the recovered Safe: leftover guardian signatures invalidated | works: module nonce 6 → 8 (start +1, invalidation +1) |
| 18-x | No error in the browser consoles | works |

## The eight runs (all in `etape-18-sortie.txt`)

| Run | Stopped at | Cause and fix |
| --- | --- | --- |
| 1 | second wallet window | The app reuses the named wallet window; the test waited for a new one. Fix (test): the client closes the wallet window after each request. |
| 2 | after completion, reading the completion tx | The app cleared the last transaction when preparing the next operation. Fix (app): list of the session's operations. The recovery itself had completed on-chain. |
| 3 | countdown not shown | After sending, the app re-read the state at the inclusion block; the public node did not have it yet, the read failed and the state stayed old. Fix (`@sq/evm`): retries for block-pinned reads. A pending recovery was left; finalized afterwards through the Client Wallet's local API with the PIN (`0x4d5e…e9d4`). |
| 4 | wallet window for completion | The test waited 30 s for the window while the operation was being prepared (bundler + paymaster). Fix (test): longer wait. |
| 5 | new key not shown | The test's new "housekeeping" (complete a recovery left pending by an interrupted run) ran after the app had loaded the old state. Fix (test): reload after housekeeping. |
| 6 | 18-5 KO | 18-1 to 18-4 OK. 18-5's on-chain criterion was met (nonce 3 → 5) but the test read the wallet screen before it was decoded. Fix (test): wait for the screen. |
| 7 | "Complete the recovery" did not produce an operation | The app compared the delay to the browser's clock; the contract compares it to the **last block's timestamp**, a few seconds behind: the bundler's estimation reverted. Fix (app): the button only appears once the last block is past the delay ("waiting for the next block" until then). |
| 8 | all criteria met | Housekeeping first completed the recovery left by run 7 (`0xa59d…cb0`). |

Each run performed a real recovery of the same Safe on Sepolia (all sponsored, no ETH). The Safe `0x2929…23AA` changed owner several times. Its current owner is the key created in run 8.

## Non-regression (`etape-18-regressions-sortie.txt`)

Typing of the 8 projects; `validate:6:ui` 19/19 desktop and 20/20 phone; invariant 5 (and `client/src` imports no EVM key derivation or signing); attacks 4/4.

## Limits

- 3-minute demo instance; target 7 or 14 days.
- The old key is not re-tested here against the recovered Safe (proven on-chain in step 16, 16-4: `Invalid account signature`).
- The contact's link is still passed by hand (A3 remaining: inbox and notification).
- Module v0.0.1 pitfalls: see step 0.
