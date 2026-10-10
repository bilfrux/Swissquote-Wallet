# Step 0: feasibility of the recovery module (10 October 2026)

## Environment

- **Where:** Anvil fork of Ethereum Sepolia (`anvil --fork-url https://ethereum-sepolia-rpc.publicnode.com`), block 11885123. The fork runs the **bytecode actually deployed** on Sepolia. **Nothing was sent to the real Sepolia**: there is no funded key or bundler API key in the environment.
- **Keys:** Anvil's public test keys ("test … junk" mnemonic). No secret.
- **Libraries:** abstractionkit 0.4.3 (module addresses, Safe init code, passkey signer address), viem 2.57.4 (calls, EIP-712). No hand-written cryptography.
- **Outside the test:** bundler, paymaster and UserOperations, reserved for step 2. Safe transactions go here through `execTransaction`, called directly by the EOA owner.

## Commands

```bash
cd scripts/feasibility
npm install
npm run fork        # in another terminal
npm run recovery    # full output: docs/validation/etape-0-sortie.txt
```

Check of the deployed code, done read-only on the real Sepolia:

```bash
cast call <module> 'VERSION()(string)' --rpc-url https://ethereum-sepolia-rpc.publicnode.com
# 0x949d…8c66 (3 min), 0x3827…541c (3 d), 0x088f…25f2 (7 d), 0x9Bac…f25b (14 d): "0.0.1", 13,606 bytes each
```

## Modules on Sepolia

| Delay | Address | Version | Measured delay |
| --- | --- | --- | --- |
| 3 min | 0x949d01d424bE050D09C16025dd007CB59b3A8c66 | 0.0.1 | 180 s |
| 3 d | 0x38275826E1933303E508433dD5f289315Da2541c | 0.0.1 | 259,200 s |
| 7 d | 0x088f6cfD8BB1dDb1BB069CCb3fc1A98927D233f2 | 0.0.1 | not measured |
| 14 d | 0x9BacD92F4687Db306D7ded5d4513a51EA05df25b | 0.0.1 | 1,209,600 s |

Safe passkey contracts used: factory 0xF7488fFbe67327ac9f37D5F722d83Fc900852Fbf, FCL verifier 0x445a0683e494ea0c5AF3E83c5159fBE47Cf9e765 (defaults of `SafeAccountV0_3_0`).

## Results

| # | Point | Verdict |
| --- | --- | --- |
| 1 | Safe 1.4.1 created with an EOA owner | works |
| 2 | Three instances (3 min, 3 d, 14 d) enabled on the same Safe, 2 guardians and threshold 2 each | works |
| 2b | EIP-712 hash computed by viem identical to the module's `getRecoveryHash` | works |
| 3a | Same address registered twice in one instance: refused (`GS: duplicate guardian`) | works |
| 3b | Same signature counted twice: refused (`duplicate signers/invalid ordering`) | works |
| 3c | Signature of one instance replayed on another: refused (`Invalid guardian signature`) | works |
| 4a-e | Swissquote alone: can neither start, nor execute, nor act outside its instances, nor add an accomplice, nor finalize | works |
| 5a-d | 14 d started by Swissquote + trusted contact: delay enforced on-chain (refusal at D+13), cancellation by the owner, signature replay refused | works |
| 6a-b | Full recovery backup + Swissquote to a new EOA (3 min): the old owner is refused (`GS026`), the new one signs | works |
| 6c | A pending 14 d recovery survives the 3 min recovery and replaces the **new** owner if not cancelled | danger confirmed |
| 6d | Cancellation on all instances by the new owner: the 14 d one no longer finalizes | works |
| 7a | Guardian change: immediate, no delay imposed by the module | confirmed |
| 7b | Removing a guardian does not cancel the recovery they started (v0.0.1) | danger confirmed |
| 9 | Swissquote gone: backup + trusted contact recover on the 3 d instance | works |
| 8a | Passkey signer address (SDK) = address returned by the factory | works |
| 8b | Recovery finalized to the undeployed passkey signer | works |
| 8c | Passkey signer deployed afterwards, by anyone | works |
| — | Signature of a transaction by the new passkey after recovery | **not tested** (needs a real WebAuthn in a browser) |
| — | Same scenario on the real Sepolia, and through bundler and paymaster | **not tested** |

## Reading the module code (v0.0.1, audited commit 113d3c0)

| Action | Who | Condition |
| --- | --- | --- |
| Confirm (`confirmRecovery`) | a guardian of the instance, for themselves | — |
| Confirm by signatures (`multiConfirmRecovery`) | anyone, relaying guardians' EIP-712 signatures | valid signatures (ECDSA or EIP-1271), signers sorted and without duplicates |
| Execute, i.e. start the delay (`executeRecovery` or `_execute = true`) | **anyone** | confirmations at least equal to the threshold, at the current nonce |
| Finalize (`finalizeRecovery`) | **anyone** | delay elapsed |
| Cancel (`cancelRecovery`) | the Safe only (owner transaction) | a recovery is pending |
| Invalidate confirmations (`invalidateNonce`) | the Safe only | — |
| Change guardians and threshold | the Safe only, module enabled | no delay |

- **The threshold:** `getRecoveryApprovals` counts the **current** guardians who confirmed the hash `(wallet, newOwners, newThreshold, nonce)`. The EIP-712 domain includes chainId and the module address, so a signature is only valid for one instance.
- **The nonce** advances at each execution and each `invalidateNonce`. In 0.0.1, `cancelRecovery` does **not** advance the nonce: confirmations collected but not yet executed survive a cancellation. `invalidateNonce` must also be called.
- **Replacing an ongoing recovery:** requires **strictly more** approvals. With 2 guardians and a threshold of 2, this is impossible: only the owner can cancel it.
- **What the module does not guarantee in 0.0.1:** it does not validate the new owners before `finalize` (audit M-01); it does not cancel a recovery when the guardian configuration changes (L-03, see 7b); 12 other fixes are missing, integrated in 0.2.0 (September 2026) but **not deployed** at the SDK's addresses.
- **Not verified:** byte-for-byte identity between the deployed bytecode and source 113d3c0. Equivalence is inferred from `VERSION = 0.0.1`, the selectors and the observed behaviour.
