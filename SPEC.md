# Spec - Swissquote self-custody wallet

Oct 10, 2026 · @Master

*(English translation of the original French spec. The section "Revisions after critical review" takes precedence over the sections before it; the later decision sections take precedence over everything before them.)*

## Goal and scope

The project delivers an EVM self-custody wallet integrated into a simulated banking app: the client signs alone, and recovery requires three guardians including Swissquote, which can never act alone. The demo follows the story required by the track document: create a wallet, log in and sign, lose everything, recover access.

| Element | Status | Detail |
| --- | --- | --- |
| Smart account, passkey, signature, testnet USDC transfer | Real | Safe + passkey, a single EVM testnet chain |
| 2-of-3 recovery, delay, revocation | Real | Existing recovery module (Candide); failing that, a small Safe module written on top of OpenZeppelin, never home-made cryptography |
| Swissquote backend (guardian, re-KYC) | Mocked, separate process | Own storage, the guardian's key is never in the client app |
| Banking app, CHF balance, KYC | Mocked | Documented in the README |
| Readable simulation before signing | Real | Client side, independent of Swissquote |
| Gasless | Real if time allows | Paymaster plugged in from step 2, 10-point bonus |
| DeFi vault journey | Real if time allows | Dropped from the solo scope, pitch perspective |
| Trusted contact liveness test | Simulated | Periodic message on the backend side |
| Succession | Same path as total loss | Long delay, no separate mechanism |

Out of scope: Bitcoin and Solana (accepted EVM limit), blocking allowlist, simulated buying and selling, face recognition as a key, zk circuit.

## Custody and recovery model

The client signs alone with their passkey, and recovery replaces the owner's key thanks to two guardians out of three, without ever reconstructing a seed phrase. This rule was validated with the judges, for recovery only and not for signing.

**The three guardians**

| Guardian | What it holds | Role |
| --- | --- | --- |
| Client | Backup key distinct from the daily passkey (second device or YubiKey) | Proves the client still has a factor |
| Swissquote | Guardian key in a separate process | Re-verifies identity (mocked re-KYC), never signs a transaction |
| Trusted contact | Guardian key, regularly tested, replaceable by the client alone | Factor chosen by the client, successor in case of death |

**Recovery paths**

| Situation | Who acts | Delay |
| --- | --- | --- |
| The client still has their backup key | Client + Swissquote, or client + trusted contact | 48 h, revocable |
| The client has nothing left (total loss or death) | Swissquote + trusted contact | 30 days, reset by any sign of life from the client |
| Swissquote has disappeared | Client + trusted contact | 48 h, revocable |

The delay depends on what the client still has, not on what the parties declare. Guardians who team up against them, without the backup key, therefore fall on the 30-day path. A living client who logs back in cancels any procedure launched against them.

**Invariants to demonstrate by tests**

1. Swissquote alone can neither sign, nor start a recovery, nor freeze the funds.
2. Swissquote + trusted contact without the backup key never finalize before 30 days.
3. A sign of life from the client during the delay cancels the recovery.
4. If the Swissquote process is stopped, client + trusted contact still recover.
5. No guardian key is stored in the client app.

**Accepted residual risk:** if the client has lost everything and Swissquote joins forces with the designated trusted contact, a fraudulent recovery remains possible. Mitigations: contact chosen by the client and never affiliated with Swissquote, alerts on several channels, visible 30-day delay. The track document calls this case a grey zone: it must be argued, not denied.

**Two consequences of this model.** A guardian cannot be replaced by Swissquote: only the client changes their contact. And the choice of module must allow two different delays, otherwise invariant 2 cannot be guaranteed on-chain and must be removed from the promises: a long path managed by the backend could be bypassed by a Swissquote colluding with the contact.

## Architecture and project skeleton

Three blocks communicate: the client app, a mocked Swissquote backend in a separate process, and the EVM testnet chain. The client app contains no Swissquote key, and the Swissquote backend has no access to any client key.

&#91;embedded content: architecture · 3 blocks, 3 external actors\]

The app relays its operations through the bundler, the guardians sign their recovery requests, and the chain alone applies the threshold and delay rules.

**Repository tree**

```text
swissquote-wallet/
  README.md          real vs mocked, diagram, threat model, AI tools
  package.json       workspaces: client, bank-mock, contracts
  .env.example       RPC, bundler, paymaster, test keys (never a real key)
  client/            web app (Vite + React)
    src/bank/        simulated bank: CHF balance, home screen (mocked)
    src/wallet/      creation, passkey, signing, USDC sending
    src/recovery/    launch, countdown, revocation, liveness test
    src/simulation/  plain-language decoding of transactions and requests
    src/lib/         viem and AbstractionKit clients
  bank-mock/         separate process, own port
    src/server.ts    endpoints: mocked identity, guardian signature
    src/guardian.ts  Swissquote guardian key
    src/liveness.ts  trusted contact liveness test (simulated)
    data/            own storage (SQLite), never read by the client
  contracts/         minimal recovery module (plan B), Foundry tests and deployment script
  scripts/           test deployment, demo reset
  tests/             custody invariants and attacks, in one command
  docs/              diagram, threat model, validation captures
```

**Technical stack**

| Component | Role | To verify |
| --- | --- | --- |
| AbstractionKit (Candide) | Safe, recovery module, UserOps | 2-of-3 threshold, cancellation, delays, testnet |
| viem | Chain reading, simulation, encoding | WebAuthn support |
| Passkey module (Rhinestone, viem or permissionless.js) | Passkey signing | Compatibility with Safe and the recovery module |
| @simplewebauthn/browser | Creating and using the passkey in the browser | Compatibility with the Safe signing flow |
| Bundler and paymaster (Candide or Pimlico) | Sending UserOps and gasless | Testnet support, API key |
| Vite + React, Node + SQLite | Client and mocked backend | No Swissquote key in the client bundle |
| OpenZeppelin + Foundry or Hardhat | Minimal recovery module (plan B), invariant tests | Written only if step 0 fails |

## Build steps

We build in this order, and only move to the next step if the validation of the previous one is observed. Two gates stop any bonus: gate A (step 2) and above all gate B (step 5), because the document grants no bonus points until create, sign and recover works end to end.

| No. | Step | Deliverable | Validation (to observe, not to assume) |
| --- | --- | --- | --- |
| 0 | Feasibility test, 1 to 2 h maximum | Safe on testnet with Candide's recovery module, several module instances with different delays, a recovery started then cancelled, then a recovery to a new passkey | Configurable 2-of-3 threshold, cancellation by the owner possible, shortened delay available for the demo, module deployed on the chosen testnet (Sepolia first), several module instances with different delays activatable on the same Safe, recovery carried through to a new passkey and not only to an EOA, and 30 minutes spent reading the module code |
| 1 | Project skeleton | Repository, three packages (client, Swissquote backend, demo contracts), environment variables, test deployment wallet | `npm install` and launching both processes without error, no real key in the repository |
| 2 | Passkey + smart account + transfer | Account creation with a passkey, address displayed, test USDC transfer signed by passkey, with the paymaster plugged in from this step so the Safe does not need ETH | **Gate A.** Transaction visible on the explorer, signed by the passkey, and reconnection possible after reloading the page |
| 3 | Mocked Swissquote backend | Separate process with its own storage, mocked identity and guardian signature endpoints, plus a "guardian console" page separate from the client app for the contact | Stopping the process cuts the guardian without breaking the client's signature, and searching for the guardian key in the client code returns nothing |
| 4 | Short recovery (client has their backup) | Configuration of the three guardians, launch screen, countdown, revocation | Client + Swissquote recovery completed with a short delay, the old passkey no longer signs, the new one signs a transfer; a revocation during the delay does cancel |
| 5 | Recovery without Swissquote + long path | Client + contact with Swissquote stopped; Swissquote + contact path with long delay | **Gate B.** Swissquote stopped, client + contact recover; Swissquote + contact without backup do not finalize before the long delay; a sign of life from the client cancels it |
| 6 | Simulation before signing | Plain-language decoding, client side, of a transfer, an approval and a recovery request | An unlimited approval is flagged, a recovery request shows who requests it, the application date and the balance concerned |
| 7 | Attack panel and invariant tests | Three demo buttons and a test suite for the five invariants | Each attack ends in an observable refusal, tests pass in one command |
| 8 | Guardian management (out of scope solo) | Replacement of the contact by the client alone, simulated periodic liveness test | Replacement possible only with the client's key, an unresponsive contact triggers the alert |
| 9 | Gasless | Already plugged in at step 2: the paymaster sponsors the USDC transfer | Successful transfer from an account without ETH, and an obvious abuse (amount or frequency) is refused |
| 10 | DeFi journey (out of scope solo) | Test ERC-4626 vault, deposit and withdrawal, DeFi simulation, approvals table | Deposit simulated in plain language before signing, received shares visible, approval revocable in one tap |
| 11 | Deliverables | README real vs mocked, architecture diagram, threat model, business case, AI tools list, backup video | An outside reader understands in two minutes what is real and what is mocked |

**Cutting rules.** Steps 8 and 10 leave the scope when solo, and gasless moves to step 2 (see the revision section at the end of the document). Steps 0 to 7 and 11 are not cut, but 6 and 7 stay minimal. If step 5 stumbles on the long delay, we remove invariant 2 and attack 2 from the promises rather than simulating them in the backend, which would make them bypassable.

**After each step:** one commit, and a capture or short recording of the validation, serving as proof in the threat model and as a fallback for the demo.

## Demo scenario and attack panel

The demo tells a single story with one client, then shows three attacks that fail, which is the project's point of differentiation. Delays are short demo parameters, and a backup video records the full journey.

**The story (4 to 5 minutes)**

1. The client opens the simulated banking app, sees their balance, creates their wallet with Face ID, designates their trusted contact and registers their backup key.
2. They send test USDC. The simulation displays in plain language what the transaction does before signing.
3. They lose their phone. On a new device, they start a recovery with their backup key and Swissquote's identity verification.
4. The countdown is displayed with the request simulation. The delay passes, the new passkey signs a transfer, the old one is refused.
5. If time allows: deposit into a vault, with DeFi simulation and approvals table.

**"Attacks" panel: three buttons, three refusals**

| Attack | What we show | Expected refusal |
| --- | --- | --- |
| Attacker with phone and email | They start a recovery from a new device | They lack the second guardian, that is the on-chain defence; Swissquote's identity verification, mocked, is only an extra layer |
| Swissquote + contact without the client | They start a recovery together, without the backup key | They fall on the long path, and a login by the client cancels it |
| Swissquote disappeared | The Swissquote process is stopped live | The client still recovers with their backup key and the contact |

The track document grants bonus credit to the demo where recovery refuses an attacker who stole phone and email, so the first attack is the priority. The second is the proof of the custody grey zone, and the third is required by the topic ("if Swissquote disappears") but rarely shown.

**To prepare before going on stage:** a pre-created demo account, a second account for the live recovery, delays set to a few minutes, the backup video, and a catchphrase: "the bank builds the tool, but never holds the keys".

## Tested threat model

Each line of this table becomes a test or an attack run in the demo, and the "Observed result" column is filled with proof (log or capture) during construction. The track document asks: who could steal the funds, who could block the client, and whether Swissquote, alone or with a partner, could move the funds without them.

| Threat | Defence | Test | Observed result |
| --- | --- | --- | --- |
| Phone theft | Passkey protected by biometrics in the device enclave | Signing impossible without biometrics | To fill |
| Theft of phone + email | Swissquote re-KYC + second guardian + revocable delay | Panel attack 1 | To fill |
| Compromised Swissquote app (malicious update) | No key in the app, on-chain rules, simulation decoded client-side | Key search in the client code, independent simulation | To fill |
| Swissquote alone wants to move the funds | No signing role, one guardian is not enough | Invariant 1 | To fill |
| Swissquote + contact without the client | 30-day long path, cancelled by a sign of life | Panel attack 2 | To fill |
| Swissquote disappears | Client + contact path | Panel attack 3 | To fill |
| False death | A sign of life from the client resets the counter | Invariant 3 | To fill |
| Unreachable trusted contact | Periodic liveness test, replacement by the client alone | Step 8 | To fill |
| Malicious dapp or approval | Plain-language simulation, alert on unlimited approval, revocation table | Steps 6 and 10 | To fill |
| Swissquote refuses to sponsor gas | The client can pay their own gas, or go through a public bundler | Transfer without paymaster | To fill |

**Residual risks to write in black and white:** Swissquote + contact collusion when the client has lost everything, griefing (Swissquote and the contact can relaunch recoveries in a loop, which the client pays to cancel), dependence on Apple or Google if the passkey is synced, EVM limit (MPC would be needed for Bitcoin), and recovery module whose audit and maturity remain to be confirmed.

## Submission content

The track document asks for six elements, and each has its anchor here. Legal statements are design hypotheses to be phrased as such, or sourced (FINMA, anti-money-laundering law) before being asserted.

| Element requested | What we write |
| --- | --- |
| Custody model and threat model | Signing by the client alone, 2-of-3 threshold recovery with delays, tested threat table, accepted residual risks |
| Architecture with mocked parts marked | The diagram of the Architecture section, with real and mocked in different colours |
| Custody and Travel Rule | Custody: Swissquote can never move the funds alone, nor with a partner of its choice. Argument on the grey zone (Swissquote + contact chosen by the client, long and cancellable delay). Travel Rule: address created in the app and linked to the mocked client, ownership proved by the passkey's signature of a challenge; when the client pays a third party, Swissquote can neither initiate nor move the transaction, reading to confirm with a lawyer |
| Business case | A small calculation with explicit assumptions: clients who withdraw to an external wallet today, retention, entry fees, avoided support cost. No real Swissquote figure without a source |
| Bonuses covered | Gasless and accompanied DeFi access, if the corresponding step passes |
| AI tools used and the use of each | To keep up to date during the weekend |

**Points to clarify with the mentors before fixing the pitch:** how Swissquote verifies external addresses today (allowlist, test deposit), and whether a list of protocols reviewed, displayed as information without blocking, changes its legal role.

## Extensions with more time

With more time, we first reinforce what makes recovery more credible, then widen the scope. Each extension is independent of the core and must never weaken it.

| Priority | Extension | Interest | Estimated cost |
| --- | --- | --- | --- |
| 1 | Address ownership proof (challenge signature verified by the bank) | Makes the Travel Rule concrete | Low to medium |
| 1 | Recovery delay modulated by the strength of the proof (USB key or in-person presence = shorter delay, never zero) | Justifies each factor by a consequence | Low |
| 2 | Enhanced confirmation above a threshold (fresh passkey, delay, notification) | Answers the document's question about large amounts | Low |
| 2 | Several designated successors, with availability versus collusion trade-off | Reduces the risk of a lost contact | Medium |
| 3 | Trusted contact with their own recovery | Removes the edge case of the lost contact | High |
| 3 | Real recovery alerts (email, notification) | Makes the revocable delay useful for real | Medium |
| 3 | "Protocol reviewed by Swissquote" signal without blocking | Information without power | Low |
| 4 | Second EVM chain with recovery replayed on each | Shows the multi-chain limit | Medium, and complicates the tests |
| 4 | Succession with real inactivity counter | Wealth angle, business argument | Medium |
| 5 | MPC variant to cover Bitcoin | Answers the EVM limit | Very high |
| 5 | zk proof of address or factor ownership | Privacy, research perspective | Very high, keep as a perspective |

To avoid even with time: recoding cryptography (signatures, EIP-712, WebAuthn), using the face as a key, or giving Swissquote a blocking power.

## Technical risks and plans B

The main risk is the passkey + Safe + recovery module + paymaster assembly, which step 0 tests first. The points below have not been confirmed in the documentation and must be verified by execution.

| Risk | Warning sign | Plan B |
| --- | --- | --- |
| Recovery module absent from the chosen testnet | Deployment not found | Switch to Ethereum Sepolia, used in Candide's examples |
| Passkey not plugged in as Safe signer | Signature refused at step 2 | Test the other WebAuthn modules (Rhinestone, viem or permissionless.js support), otherwise classic key account for signing and passkey for app access, documenting it |
| 2-of-3 threshold or revocation missing | Functions not exposed at step 0 | Other existing recovery module; otherwise small Safe module written on top of OpenZeppelin (see the revision section), without recoding signatures, EIP-712 or WebAuthn |
| Only one delay available | Impossible to distinguish 48 h and 30 days | Several module instances on the same Safe; otherwise remove invariant 2 and attack 2 from the promises, because a long path managed by the backend would be bypassable by a Swissquote colluding with the contact |
| Minimum delay too long for the demo | Smallest delay of several days | Demonstration on a forked local network with time advance, or recorded video |
| Paymaster unavailable on the testnet | API key refused or network unsupported | Other provider, otherwise gasless presented as a perspective |
| Demo failing live | Capricious delay, network or passkey | Backup video recorded at each gate, pre-created accounts |
| Not enough time | Gate B not passed at mid-course | Cut the extensions and concentrate on the basic flow and the main attack demo |

**Decision rule:** if step 0 fails on two criteria, we change module before writing a single line of the application.

## Revisions after critical review

The review judges the concept solid but the plan sized for three people: solo over 24 h, we keep steps 0 to 7 and 11 in minimal version, drop steps 8 and 10, and first validate that the two delays are really expressed on-chain.

**The two delays: hypothesis to test at step 0**

Candide's recovery module has, unless mistaken, a single delay and a single threshold per configuration, so the rule "backup mandatory for the short path" cannot be expressed with a single 2-of-3 threshold. A long path managed by the backend is to be ruled out: if it is Swissquote that refuses to sign before the delay, a Swissquote colluding with the contact can sign immediately, and invariant 2 proves nothing anymore. Working hypothesis reported by the review, which I could not confirm in the documentation: Candide would deploy one module singleton per delay (3 minutes, 3 days, 7 days, 14 days), each storing its configuration per account, which would allow one Safe to enable several instances.

| Module instance | Guardians | Threshold | Path |
| --- | --- | --- | --- |
| 3 minutes | Backup + Swissquote | 2 | Short: phone lost, backup available |
| 3 days | Backup + contact | 2 | Swissquote has disappeared |
| 14 days | Swissquote + contact | 2 | Long: the client has nothing left, or death |

In the previous sections, "48 h" and "30 days" designate the short and long delays: the real values are those of the available instances. The long path does not need to succeed in the demo: it is enough to show it pending, then cancelled by the client. The 3-day path is shown on a local fork with time advance, or on video. If the combination works, invariant 2 becomes truly on-chain, which is the best argument before the judges.

**If the instances are not enough: a small Safe module written by us**

The track document forbids reinventing cryptography, not writing a contract: a small logic module on top of established libraries is defensible, to confirm with the mentors.

1. **Step 0:** test several instances of Candide's module. The decision is taken at the end of step 0.
2. **If it fails:** minimal Safe module, written after gate A and limited to 3 h. For each path it keeps its guardians, threshold and delay, records a pending recovery, lets the owner cancel it and, once the delay has elapsed, asks the Safe to change the owner. Estimate: 150 to 250 lines, to confirm.
3. **Not to recode:** signature verification, EIP-712 hashing and WebAuthn support, taken from OpenZeppelin and the Safe libraries.
4. **Proof:** Foundry invariant tests on this module directly demonstrate that Swissquote alone does not move the funds.
5. **To ask the mentors during step 0:** is a small Safe module written by us, based on OpenZeppelin, acceptable?
6. **If the 3 h are exceeded:** remove invariant 2 and attack 2 from the promises, and write in the threat model that the module is not audited.

**Other risks to integrate**

- **Backup key on a YubiKey:** a YubiKey over WebAuthn signs in P-256, not secp256k1. Making it a guardian requires a guardian smart account (EIP-1271), i.e. hours more. In 24 h, the backup is an EOA stored in another browser or a file, and the YubiKey remains a perspective.
- **Recovery to a new passkey:** the passkey owner of a Safe is a WebAuthn signer contract, not a simple address. Its address must be computed, and it probably must be deployed. Step 0 tests a recovery to a passkey.
- **Synced passkeys:** on Mac, Chrome and Safari sync passkeys through iCloud or Google, so the new device would find it. Staging: another browser profile, passkey deleted in front of the audience.
- **The contact in the demo:** a "guardian console" page separate from the client app, which respects invariant 5.
- **Attack 1:** present the on-chain defence first (the second guardian is missing), since re-KYC is mocked.
- **Griefing:** Swissquote and the contact can relaunch recoveries in a loop, which the client pays to cancel. To write as a residual risk, not to solve.

**What changes in the plan**

- Gasless plugged in at step 2 if the paymaster sponsors on the testnet, without abuse detection.
- Steps 8 and 10 out of scope. Replacing the contact is a simple call by the owner to the module, one sentence in the README. The DeFi journey becomes a perspective in the pitch.
- Step 7: the attack scripts serve both as tests and as panel buttons.
- Minimal step 6: viem's `decodeFunctionData` on three ABIs, and an alert when the approval equals `maxUint256`.
- During step 0, read the recovery module's code, which is short: the whole pitch rests on its guarantees and the judges will dig into it.

**24 h solo schedule**

| Slot | Content |
| --- | --- |
| H0 to H2 | Step 0, with several module instances and recovery to a passkey |
| H2 to H3 | Skeleton |
| H3 to H7 | Passkey + Safe + USDC + paymaster: gate A |
| H7 to H8:30 | Mocked backend + guardian console |
| H8:30 to H11:30 | Short recovery, countdown, cancellation |
| H11:30 to H14 | Path without Swissquote + long path: gate B, then backup video |
| H14 to H16 | Sleep, non-negotiable when solo |
| H16 to H19 | Simulation + attack scripts |
| H19 to H22 | README, threat model, business case, slides |
| H22 to H24 | Rehearsal and margin |

If gate B is not passed at H14, everything that follows is reduced to the basic demo and attack 1.

## Decisions after review

These decisions, taken on 10 October 2026 after the spec review, take precedence over the rest of the document, including the "Revisions after critical review" section, where they differ.

**Blocking points**

1. **Backup signature.** The backup signs through the guardian console: a page separate from the client app, where the key is imported at run time (paste or file) and never persisted (no localStorage, no logs, no state). Invariant 5 forbids any guardian key storage in `client/` and its bundle. The contact signs the same way.
2. **Sign of life.** A sign of life is a cancellation transaction signed by the owner's current passkey. The backend draws no consequence from a login to the app. This covers false death, not a client who has lost everything: to write in the threat model.
3. **Invariant 1.** At step 0, define precisely who can propose, confirm, execute, finalize and cancel, and whether finalization is open to everyone. The tested invariant becomes: Swissquote alone cannot make the Safe's owner change through any sequence of these actions.
4. **Concurrent instances.** After any successful recovery, the new owner cancels all recoveries still pending on all instances. The recovery screen does it, and the step 4 test checks it.

**Secondary points**

5. **Cancellation in a loop by the old passkey** (thief, compromised synced passkey): residual risk to write.
6. **Paymaster.** It is operated by a third party (Candide or Pimlico), not by Swissquote. The "without paymaster" test requires funding the Safe with test ETH, separately from the "0 ETH" validation of step 2.
7. **3-day path in the demo.** Direct calls by the guardians (EOA) on a local Anvil fork with time advance, or video. To attempt after gate B, if time allows.
8. **Delays.** Demo values: 3 min, 3 d, 14 d. Target values (hypothesis): 3 d, 7 d, 14 d. If the module stores a configuration per account and per delay, two instances cannot share a delay: to verify at step 0. The pitch presents these values as parameters.
9. **Gasless.** Plugged in at step 2, without abuse detection. The step 9 validation therefore reads: "successful transfer from an account without ETH", without a requirement to refuse abuses.
10. **"Signing impossible without biometrics"**: to be written "declared", not "tested", in the threat model.
11. **`liveness.ts`**: out of scope solo.

**New decisions**

- **On-chain rules only.** All rules (threshold, delays, cancellation) live in the contract. Nothing is ever enforced by the backend. If a delay cannot be enforced on-chain, we remove the invariant concerned from the promises, we do not simulate it.
- **Solidity, in a limited way.** At the end of step 0, we choose between (a) several instances of Candide's module, (b) a small Safe module written on top of OpenZeppelin, after gate A and limited to 3 h, (c) another existing module. Never home-made cryptography: no signatures, no EIP-712, no WebAuthn.
- **One guardian = one address = one vote.** Verify at step 0 that the same address cannot be registered twice, and that the same signature cannot count twice or be replayed.
- **Guardian change.** Only the owner can do it, through a Safe transaction. The contact is present in two instances: both would have to be changed in a batched transaction, adding before removing. Check whether the module imposes a delay to modify guardians; otherwise, residual risk (a thief who bypasses biometrics could make themselves a guardian). Out of scope solo: we only verify.
- **Recovery to a new passkey.** The owner is a WebAuthn signer contract. Step 0 tests recovery to a passkey, not only to an EOA.
- **Exit kit.** The contract must be callable without the app. A minimal open-source tool is a perspective, to do after gate B. WebAuthn requires a browser: the tool will be a local page on localhost.
- **Configurable chain.** Ethereum Sepolia first. If the module is not deployed there, change testnet before writing code.
- **Demo.** A single owner. Recovery staging: another browser profile, passkey deleted in front of the audience. Backup = EOA in another browser or a file.
- **Scope.** Steps 8 and 10 out of scope. Steps 6 and 7 minimal.

## 2-guardian model (10 October 2026, takes precedence over everything else in the document)

This section replaces the previous models (passkey, backup, D1/D2/D3 paths, WebAuthn signer). Their code is kept on the `archive/exploration-etape-0` branch.

**Model**
- The client keeps their seed phrase in an external wallet. The app holds **no** private key of the client: no encrypted key in the browser, no passkey, no PRF.
- Two guardians: Swissquote (key in `bank-mock/`, separate process, own storage) and the trusted contact (key imported at run time in the guardian console, never persisted).
- A single policy and a single delay D per chain.

**Bitcoin (priority 1)**
- Policy: `or(pk(CLIENT),and(pk(SWISSQUOTE),and(pk(TRUSTED),older(D))))`. The nested form is mandatory, because `and()` only accepts two arguments in the policy language. It compiles to `andor(pk(S),and_v(v:pk(T),older(D)),pk(C))`.
- P2WSH script. Ranged descriptors for the three keys (`/0/*` for receiving, `/1/*` for change), BIP48 derivation `m/48'/1'/0'/2'` on testnets. The xpub is supplied with its origin: `[fingerprint/48'/1'/0'/2']tpub…`.
- Client spend: the app prepares a PSBT, the client signs it in their external signer, the app finalizes and broadcasts. `tools/client-signer` replaces Sparrow or a hardware wallet for the demo and is labelled as such. Real external signer validated: Bitcoin Core (descriptor wallet, `walletprocesspsbt`). Sparrow does not handle Miniscript policies with a delay (issues #1700 open and #1757 declined), so it is not retained.
- Recovery: if the coins have not moved for D blocks, Swissquote and the contact each sign the PSBT to a new address of the client.
- Refresh: a send to self resets the delay, per UTXO. The app warns before expiry.
- D: 6 blocks for the demo (regtest and signet). Target value presented in the pitch: about 6 months (≈ 26,000 blocks), as a parameter.
- Ownership proof (**optional**): `bip322-js` does not handle P2WSH. Fallback: the client signs the challenge with their public key that appears in the policy; bank-mock verifies the signature and recompiles the address.
- Networks: regtest (bitcoind 29 in Docker) to cross the delays; signet (Esplora API of blockstream.info) for real transactions.

**Ethereum (priority 2, only after Bitcoin gate B)**
- Safe whose owner is the client's EVM account, signed from an external wallet. A single instance of Candide's recovery module, with two guardians (Swissquote and contact), threshold 2.
- After any recovery, call `cancelRecovery` and `invalidateNonce`. Removing a guardian does not cancel an ongoing recovery (version 0.0.1).
- The app presents a single wallet with two accounts. The Safe is only deployed on first use.

**Invariants**
1. Swissquote alone cannot spend through any path.
2. Swissquote + contact cannot spend before D since the last movement of the coins (real consensus error).
3. A client who refreshes before D blocks any recovery.
4. The client spends alone at any time, even if Swissquote is stopped.
5. No private key of the client in the app, and no guardian key in `client/` or its bundle.

**Attacks** (tests and buttons): attacker without the guardians' keys (refusal); Swissquote + contact collusion before D (refusal); Swissquote stopped, the client spends alone (success).

**Limits**: client key lost and Swissquote gone, then the funds are lost. Contact who loses their key, then they must be replaced with a new policy. Grey zone: Swissquote + contact can spend after D, to any destination. Different semantics on Ethereum (cancellation) and on Bitcoin (refresh). Few external wallets handle Miniscript (Liana, Bitcoin Core, Ledger, Coldcard, BitBox02). With P2WSH, a spend reveals the policy; Taproot is a perspective. No gasless or dApp.

**Order**: 1. Bitcoin, gate A. 2. bank-mock + guardian console. 3. Bitcoin recovery, gate B. 4. Attacks and invariants. 5. Deliverables. 6. Ethereum.

## Banking interface and Client Wallet (step 6, 10 October 2026)

This section completes the "2-guardian model", without modifying it.
- **Bank app (simulated)**: mocked e-banking login, tabs Overview / Accounts / Crypto wallet. The Demo · Attacks tab only exists on regtest. Recovery is a separate screen, opened from "I lost my wallet".
- **Client Wallet** (`client-wallet/`): **reference implementation** of an external wallet (in production: hardware wallet or phone app). Separate app, with its own process and own storage.
  - It generates the seed with `@scure/bip39`, shows it **once**, and only transmits the extended public key to the bank.
  - It signs only after a confirmation screen that decodes the PSBT: outputs, amounts, fee, spending path. It refuses to sign a recovery PSBT.
  - The bank app talks to it through a window (`postMessage`, with origin check). Its API refuses any request from another origin.
- **Contact**: they create their identity in the guardian console (phrase shown once) and send their public key to the client, who enters it with their name when creating the wallet.
- The bank app **never receives** the seed or any private key of the client.

## Ownership proof and blank demo client (step 7, 10 October 2026)

- Ownership proof **done**. bank-mock issues a single-use challenge (10 min) for address #i of an account of the logged-in client. The Client Wallet signs it (BIP-322 "simple", `bip322-js`) with its client key at index i, for the P2WPKH address of that key. bank-mock recomputes the key from the registered xpub and verifies in strict mode.
- Exact scope: possession of the client key, which alone is enough to spend the address according to the registered policy. This is not a signature of the P2WSH address itself (not handled by `bip322-js`).
- Blank demo client `CH-0003` (Léa Martin, `demo0003`, re-KYC `Martin` / `1992-03-21` / `246810`).
- Ethereum and Taproot: perspectives, not implemented (README).

## Decisions of 10 October 2026 (evening): detailed track, EVM reinstated, work order

Reading of the detailed track (`Swissquote Wallet Challenge_EPFL Hackathon_Oct2026.docx`): 6 mandatory topics, scored out of 100 (technical 35, security 20, legal 15, business 15, UX and pitch 15); up to +20 bonus (gasless, compliant dApp interaction), granted only if creation → signing → recovery works end to end.

- **EVM reinstated**, priority **once the Bitcoin part is finished**. Account: **Safe whose owner is the client's EOA** (key in the Client Wallet), Swissquote + contact recovery through the Candide module. An EOA alone would remove the assisted recovery requested by the track.
- Validated order:
  1. Finish Bitcoin: end-to-end story in the interface on signet; **A1** authentication (passkey) and handling of high-value amounts; **A2** Swissquote account ↔ wallet transfer with automatic ownership proof (Travel Rule); **A3** recovery without copy-paste (contact's inbox).
  2. EVM: Safe + recovery; **gasless** (ERC-4337 + paymaster or EIP-7702: who pays, how abuse is prevented); **compliant dApp interaction** (approved list, mocked sanctions screening, plain-language simulation, controls above a threshold); then the "MetaMask equivalent" features.
  3. **A4** written deliverables, as we go: comparison of the 5 custody models, custody and grey zone argument, Travel Rule, quantified business case.
