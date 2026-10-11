# Threat model

One wallet, two accounts from the same secret phrase (kept in the Client Wallet), with **two different recovery mechanisms**:

| | Bitcoin (signet) | Ethereum (Sepolia) |
| --- | --- | --- |
| Account | P2WSH script (Miniscript): `or(pk(CLIENT), and(pk(SWISSQUOTE), and(pk(TRUSTED), older(D))))` | Safe owned by the client's key + Candide recovery module v0.0.1 (guardians Swissquote and trusted contact, threshold 2) |
| When can Swissquote + contact act? | **Automatically opens** on any coin that has **not moved for D blocks** (demo D = 6 blocks; target ≈ 6 months) | Only if they **actively start** a recovery; it then waits a delay enforced by the contract (demo 3 minutes; target 7 or 14 days) |
| How the client keeps control | Be active: any spend resets the coins it moves; **"Refresh" resets all coins in one transaction** | Nothing to do while nobody starts a recovery; **if one starts, cancel it** during the delay ("Cancel this recovery") |
| Scope | Per coin (UTXO) | The whole account at once (USDC and any other token): the recovery changes the Safe's owner |
| Who enforces the rule | Bitcoin consensus (BIP68/112) | The recovery module contract |

The two chains are independent: a transaction on one never affects the other's delay or recovery.

The "Observed result" column only reports what was executed and recorded in `docs/validation/`. Without evidence, the cell says **not tested**. The recorded outputs keep the language they were produced in (French before the interface was translated to English).

## The three questions of the track document

| Question | Bitcoin | Ethereum | Evidence |
| --- | --- | --- | --- |
| Who could steal the funds? | The client alone, at any time. Swissquote + trusted contact **together**, only on coins that have not moved for D blocks (grey zone below). Nobody else. | The client alone, at any time. Swissquote + trusted contact **together**, by starting a recovery that the client **does not cancel** within the delay. Nobody else. | Bitcoin: invariant 1, attacks 1 and 2 (`etape-4-attaques-sortie.txt`). Ethereum: steps 16 and 18 (real Sepolia) |
| Who could block the client? | Nobody: the client's spend needs neither Swissquote, nor the trusted contact, nor the Swissquote app (any Bitcoin node or explorer is enough). | Nobody can block the owner's key. Without the paymaster (a third party, not Swissquote), the client pays gas in ETH or uses another bundler. | Bitcoin: attack 3, step 2 test 7. Ethereum: owner-only actions proven in steps 16-18; spending without paymaster **not tested** |
| Can Swissquote, alone or with a partner, move the funds without the client? | Alone: no, consensus rejects both paths. With the trusted contact: yes, after D, if the client has not refreshed their coins. | Alone: no, the module requires 2 guardians. With the trusted contact: yes, after the delay, if the client has not cancelled. | Bitcoin: invariant 1; attack 2 ("grey zone" line). Ethereum: 16-2, 18-1; 16-3 to 16-5 |

## Threats: Bitcoin

| Threat | Defence | Test | Observed result |
| --- | --- | --- | --- |
| Phone theft: the bank app falls into an attacker's hands | The app holds no private key (public keys and unsigned PSBTs only) | `npm run validate:inv5`; step 1 UI-5 (localStorage); step 6 test 6-4 | None of the machine's 14 seeds in `client/` or its bundle, with positive control 14/14; localStorage = public configuration only (`etape-4-invariant-5-sortie.txt`, `etape-1-ui-sortie.txt`) |
| Theft of phone + email | Swissquote re-KYC (mocked); above all, both guardians and the delay D are enforced on-chain | Attack 1 (`npm run test:attacks`, panel button) | Re-KYC refused (403); after D, the attacker's signatures rejected: `mempool-script-verify-flag-failed (Signature must be zero for failed CHECK(MULTI)SIG operation)` |
| Stolen bank password (phishing) | Passkey login (WebAuthn, user verification); in any case, the app cannot spend | Step 6, test 6-17; `npm run validate:10` (failure cases) | Passkey login observed; step-up refused without a passkey, without a session, or with an invented assertion |
| High-value transfer without the client's knowledge, or substituted address | Passkey re-authentication with Swissquote (with alert) above 0.2 BTC; in the wallet, PIN + last 6 characters of the address, verified by its server | `npm run validate:10`; step 6, test 6-18 | Signature refused without the right characters; full journey observed. **Limits**: nothing on-chain on Bitcoin; step-up is non-blocking if Swissquote is unreachable (**this case is not tested in the interface**) |
| Swissquote alone wants to move the funds | No path of the script is satisfied by the Swissquote key alone | Invariant 1 | Rejected by consensus, even after D: recovery path `Script failed an OP_CHECKSIGVERIFY operation`; client path `Signature must be zero for failed CHECK(MULTI)SIG operation`; the library refuses to finalize |
| bank-mock compromised: signs anything | The Swissquote signature is never enough: the trusted contact AND D blocks are also required | Attack 2 (bank-mock bypassed); invariant 1 | Collusion rejected before D: `non-BIP68-final` |
| Swissquote + colluding trusted contact, before D | `older(D)` enforced by consensus (BIP68/112) | Attack 2; step 3 test 1; signet | Regtest: `non-BIP68-final` at 1 and 5 confirmations. Signet: `sendrawtransaction RPC error -26: non-BIP68-final` (`etape-3-signet-sortie.txt`) |
| **Swissquote + colluding trusted contact, after D, coins not refreshed** | No technical defence (accepted grey zone): contact chosen by the client, in-app warning, refresh | Attack 2, information line | **Accepted by the node at D** (not broadcast): residual risk |
| **Race after D**: the client and the guardians both spend the same coins | Whichever transaction is confirmed first wins (consensus). Mempool policy (Bitcoin Core 29, full RBF): a client spend with a higher fee replaces a recovery not yet mined | Step 14 (`validate:3` tests 5, 6, 7) | Client confirmed first: the guardians' recovery is rejected (`missing-inputs`). Guardians confirmed first: the client's spend is rejected (`missing-inputs`), funds on the recovery account. Recovery in the mempool, client at 20 sat/vB: the client's spend accepted and mined, recovery evicted. **Limits**: mempool policy only, a miner can include the recovery anyway; the guardians can bump their fee too (fee war) |
| The recovered key does not really work, or the old key still signs | The new account is a new policy with the new client key | Step 14 (`validate:3` test 4) | New key spends the recovered funds alone (`accepted`); old key signs no input of the new account (`No inputs were signed`) |
| The client does not see that a recovery is approaching, or has been started | In-app warning; bank-mock alerts (coin at ≤ ⌈D/3⌉ blocks, recovery open, **recovery signed by Swissquote**) in the bell and by simulated email; refresh button | Step 3 UI-1; `npm run validate:8:alerts`; step 6 test 6-15 | Alerts created at the right threshold, without duplicates; immediate alert on the old device when Swissquote signs. Information only: depends on Swissquote, email simulated, real push **not tested** |
| An already signed recovery stays valid after a refresh | The refresh spends the coins: the signed transaction references inputs that no longer exist | Step 3 test 2 | `missing-inputs` rejection; new recovery on the refreshed coin rejected (`non-BIP68-final`): the delay restarts from zero |
| Swissquote disappears (process stopped) | The client path does not depend on Swissquote | Attack 3; step 2 test 7 | bank-mock unreachable (`ECONNREFUSED`); client spend broadcast and confirmed |
| Swissquote disappears **and** the client loses their key | None | — | **Not tested, by construction: funds lost.** Extension: backup + trusted-contact path with a longer delay |
| The trusted contact loses their key | The client replaces the contact while they still have their key (new policy, coin move) | — | **Not tested**: replacement not implemented; without a contact, recovery is impossible |
| Swissquote signs a recovery to a foreign address or another client's coins | bank-mock checks (secondary layer): recovery only, inputs from an account of the client, outputs to another account of the same client | Step 2 test 5 | Three 403 refusals with reason |
| Fraudulent re-KYC (attacker passes identity verification) | The trusted contact's signature and D blocks are still required; warning to the client | Partially: attack 2 (collusion) | Refusal before D observed; a really bypassed re-KYC is **not tested** (mocked KYC) |
| The PSBT shown to the client is malicious (compromised Swissquote app) | The Client Wallet decodes the PSBT itself and shows path, outputs (its own recognised thanks to the registered policy), amounts and fee before signing; the client can refuse | Step 6, tests 6-6 (confirmation screen, refusal relayed to the app) | Display and refusal observed; real checking of the address by the user **not tested** |
| The bank app tries to obtain a signature without confirmation, or to read a key | Client Wallet API without CORS, and refusal of any request from another origin before execution; interaction possible only through the wallet window | Step 6, test 6-7 | Read blocked in the browser; POST with the bank's origin refused (403) |
| The client's seed leaks to the bank | Seed generated and stored in the Client Wallet; only the public key travels | Step 6, test 6-4; `npm run validate:inv5` | Phrase absent from the app's storage and page and from Swissquote's database; Client Wallet seeds absent from `client/` and the bundle |
| The wallet signs a recovery without the client's knowledge | The Client Wallet refuses to sign the recovery path (this path does not involve its key) | Step 6, test 6-12 | 400 refusal "recovery path" |
| Theft of the device holding the Client Wallet | Seed encrypted by PIN (scrypt + AES-256-GCM); PIN at every signature; 60 s lockout after 5 errors. In production: secure element | `npm run validate:8:pin` | No word of the phrase in clear on disk; wrong PIN refused; lockout observed. **Not covered**: file theft and offline exhaustive search of a 6-digit PIN |
| Leak of the trusted contact's phrase through the guardian console | Phrase read on click, used, erased; never in state, storage or logs | Step 2 UI-4 | Absent from localStorage, sessionStorage, the DOM and fields after signing; compromised browser of the contact: **not tested** |
| The client declares an external address that is not theirs (Travel Rule) | Single-use Swissquote challenge, signed by the client key at the address index; strict verification (BIP-322) with the key recomputed by Swissquote from the registered xpub | `npm run validate:7`; step 6, test 6-13 | Valid proof accepted; replay (409), altered message, other key, BIP-137 format and another client's account refused. **Scope**: proves possession of the client key, which alone is enough to spend the address according to the registered policy; it is not a signature of the P2WSH address itself |
| Swissquote sends custody funds to a wallet that does not belong to the client (Travel Rule), or credits funds of unknown source | Withdrawal only to an address of an account registered to the client **and** after a verified ownership proof for that address; deposit credited only if all its inputs come from a wallet registered to the client; Travel Rule record | `npm run validate:11`; step 6, test 6-19 | Withdrawal refused without proof (412) and to a foreign address (403); deposit of unknown origin held, not credited. **Limits**: regtest only; no chain analysis or screening |
| The request relayed to the trusted contact is replaced by another transaction | The relay only accepts a signed PSBT of the same transaction (combination checked); the contact decodes the request in their console before signing | `npm run validate:12`; step 6, test 6-20 | Foreign transaction refused (400); unknown identifier refused (404). **Limit**: anyone with the link can read the request (not spend) |
| Replay of a guardian signature on another account | Signatures cover the transaction (BIP143 sighash) and the account script | Step 2 test 5 (other client) | Refused upstream by bank-mock; on-chain replay **not tested separately** |
| Swissquote refuses to serve the API or to relay | Broadcast goes through any node or explorer | Step 1 (broadcast via public Esplora); attack 3 | Observed |
| Physical attack ("wrench attack") targeting the deadline | None; with P2WSH, every spend reveals the policy and the delay | — | **Not tested**: residual risk; Taproot as a perspective |
| Griefing: repeated recovery requests | A request that cannot be broadcast before D has no on-chain effect; the client refreshes | — | **Not tested** |

## Threats: Ethereum (Sepolia)

| Threat | Defence | Test | Observed result |
| --- | --- | --- | --- |
| Swissquote alone starts a recovery | Threshold 2 in the module: one guardian signature is not enough | Step 16, 16-2 (real Sepolia) | Refused: `SM: confirmed signatures less than threshold` |
| Swissquote alone adds an accomplice guardian, or finalizes, or acts outside its instance | Only the Safe (owner) changes guardians; finalization needs a pending recovery whose delay has elapsed | Step 0, 4a-e (Sepolia fork) | All refused |
| Swissquote signs without identity check, or to an address of its choice | bank-mock signs only after re-KYC, for a Safe of the verified client, to a key that is neither the current owner nor a guardian (extra layer; the contract remains the defence) | Step 18, 18-1 | `403 identity not verified` ; `403 the new owner must be a new key of the client` |
| Swissquote + trusted contact finalize too early | Delay enforced by the contract | Step 16, 16-3; step 18 | Refused: `SM: recovery period still pending` |
| **Swissquote + trusted contact start a recovery the client did not ask for** | The current owner cancels during the delay (`cancelRecovery` + `invalidateNonce`); the app shows "Recovery in progress on this account… cancel it now" | Step 16, 16-5 (script); cancel button in the interface (step 17) | Cancelled; finalization afterwards refused: `SM: no ongoing recovery`. **Cancellation from the interface not tested by an automated run** |
| The old (lost or stolen) key keeps control after a recovery | The recovery replaces the owner | Step 16, 16-4 | Old key refused: `INVALID_SIGNATURE: Invalid account signature`; new key signs |
| Leftover guardian signatures reused later | The new owner invalidates the module nonce right after the recovery (project rule) | Step 18, 18-5 | Nonce advanced by 2 (start + invalidation) |
| The trusted contact's signature is replaced in the relay | Swissquote checks it is the registered contact's EIP-712 signature of this request | Step 18, 18-2 | Accepted only from the registered contact; the console checks on-chain that the contact is a guardian |
| The same signature counted twice, or replayed on another module instance | Sorted, distinct signers; the EIP-712 domain includes the chain and the module address | Step 0, 3b and 3c (fork) | Refused (`duplicate signers`, `Invalid guardian signature`) |
| The bank app asks the wallet to sign a malicious operation (compromised app) | The Client Wallet decodes the operation itself (single call or batch) and **refuses** any call it cannot explain; unlimited approvals flagged | Step 17, 17-3 | `400 refused: not decoded` |
| The app reads a stale state (public node) and misleads the client | All reads after an operation pinned to the inclusion block, with retries; Swissquote syncs the owner at the finalization block | Steps 16, 18, 20 | Defects found and fixed (stale nonce, stale owner); runs recorded |
| Sponsorship abused (many free operations) | The paymaster is a **third party** (Candide public policy); Swissquote does not operate it | — | **Not covered**: limits of the public policy unknown to us; a private policy would let Swissquote set limits |
| High-value USDC transfer without the client's knowledge | Client Wallet confirmation screen with the decoded transfer | Step 17, 17-4 | **No enhanced confirmation by amount on Ethereum** (Bitcoin has one) |
| Swissquote disappears | The owner's key still controls the Safe; operations can go through any bundler, or as plain transactions paid in ETH | — | **Not tested** for Ethereum |

## Residual risks (to be argued, not denied)

**Both networks**

1. **Custody grey zone**: Swissquote + trusted contact together can take the funds, to any destination, if the client does not react (Bitcoin: no refresh before D; Ethereum: no cancellation during the delay).
2. **Swissquote closed + client key lost = funds lost.**
3. **Trusted contact who loses their key = recovery impossible**, as long as the client has not replaced them.
4. **Reference Client Wallet**: seed encrypted by a PIN, but a 6-digit PIN does not withstand an offline exhaustive search if the file is stolen. A secure element (hardware wallet, phone enclave) is required in production.
5. **Mocked components**: re-KYC, bank session. Re-KYC is only an extra layer: the real defence is on-chain.

**Bitcoin**

6. **Cost of refreshing**: moving the coins before D, in fees and on-chain traces (one transaction for all coins).
7. **Few compatible external wallets**: Bitcoin Core verified; Liana and hardware wallets announced, not verified; Sparrow most likely not.
8. **Privacy**: the policy is revealed at every spend with P2WSH.

**Ethereum**

9. **The client must notice a hostile recovery within the delay.** Unlike Bitcoin, an active but inattentive client is exposed: alerts (bank-mock notifies when Swissquote signs an Ethereum recovery: **not tested by an automated run**) depend on Swissquote; hence a long target delay (7 or 14 days).
10. **Griefing**: Swissquote + contact can start recoveries repeatedly; each one must be cancelled (gas currently sponsored by the paymaster).
11. **Module v0.0.1** (deployed version): removing a guardian does not cancel a recovery they started; new owners are not validated before finalization (audit M-01). Fixes exist in 0.2.0, not deployed at the SDK's addresses (step 0).
12. **Dependence on third parties** for gasless: bundler and paymaster (Candide public endpoints), public Sepolia node (rate limits, stale reads seen).
13. **Out of scope**: compliant dApp interaction, DeFi, Taproot.
