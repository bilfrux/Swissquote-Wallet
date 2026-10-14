# Pitch, 5 minutes: about 2 minutes of slides, then the live demo

Deck: `swissquote-wallet-2min.pptx` (6 slides, speaker notes included). Rebuild: `node docs/slides/build-2min.cjs` (needs `pptxgenjs`).

The pitch is built as a demonstration: **A + B**.
- **A**: the client's own key, always able to spend alone.
- **B**: a rule enforced by the chain, not by Swissquote: Swissquote and a trusted contact recover together, only after a delay.
- From A + B, four properties follow, each tested on a real node (`docs/validation/`).

## Part 1: slides, about 2:00 (about 250 words: count them again if you change the text)

| Time | Slide | Say |
| --- | --- | --- |
| 0:00 | 1. Your keys. Your control. | "Self-custody means leaving the bank. We built the wallet where clients keep their keys and stay with Swissquote." |
| 0:10 | 2. A + B: why it holds | "Our design is A plus B. A: the client's own key, always able to spend alone. B: a rule enforced by the chain: Swissquote and a trusted contact can recover, but only after a delay. So Swissquote alone can do nothing, before the delay the network refuses, and a lost key is recoverable. All tested on a real node." |
| 0:35 | 3. One answer to each point of the brief | "Every point of the brief has a one-line answer here. Two to notice: the server checks a biometric passkey to open the crypto area, so a stolen password gets nothing; and if Swissquote disappears, an Emergency exit signs with the client's key alone." |
| 0:55 | 4. Why not MPC or a smart wallet? | "Why not MPC or a smart wallet? I looked at both first. MPC lets Swissquote and a partner sign immediately: the delay is only software. My first plan, a Safe with a passkey, had too many problems, and it is Ethereum only, so no Bitcoin. So the key is a plain seed and the delay is Bitcoin consensus. On Ethereum, we do use a Safe." |
| 1:25 | 5. What Swissquote gains | "Why Swissquote? Today self-custody means the client withdraws and takes the trades away. Here the flows stay in the app. Swissquote cannot move the funds alone, so, subject to a lawyer, no custody burden. Travel Rule proofs become automatic. Honestly, break-even is about 2,700 clients at our illustrative numbers." |
| 1:55 | 6. Real and mocked, openly | "Real: keys, scripts, delays, transactions. Mocked: the bank and the KYC. Now, live." |

Slides 3 to 5 are dense on purpose: the jury can read them while you talk. If you run long, shorten slide 5 first, not the A + B slide.

### What backs each claim

| Claim | Where it is shown |
| --- | --- |
| Four properties of A + B | `docs/custody-models.md` (tested items), `npm run test:attacks`, `docs/validation/etape-3.md`, `etape-14.md` |
| The server checks a biometric passkey to open the crypto area; a stolen password gets nothing | `docs/validation/etape-38.md` (reported 8 of 8; the validation was **not re-run** by me after the merge). Observed by me: without unlock, a crypto route answers `403 crypto locked: confirm with your biometrics` |
| Emergency exit: the client's key alone, no Swissquote | `docs/validation/etape-41.md` (reported 5 of 5, not re-run). **Bitcoin only**: Ethereum has no exit kit |
| The wallet belongs to the device, not to the bank account | `docs/validation/etape-40.md` |
| The contact can be changed (new script, coins moved, delay restarts) | `docs/validation/etape-43.md` |
| MPC: Swissquote + partner sign at once; delay only in software | `docs/custody-models.md`. The `cb-mpc` limits (no browser or mobile, no recovery workflow) were **read in its README, not executed**: say "in its docs" if asked |
| Smart wallet first plan and its problems | `SPEC.md` (sections "Revisions after critical review" and the 2-guardian model): the one delay and one threshold per module, passkey owner as a signer contract, YubiKey signing P-256, EVM-only. These were **identified risks** in the spec, not all re-measured; do not say "it failed" |
| We do use a Safe on Ethereum | `docs/validation/etape-16.md`, `etape-17.md`, `etape-18.md` (real Sepolia) |
| Business case and break-even (about 2,730 clients) | `docs/business-case.md`. All inputs are illustrative, none is a Swissquote figure |
| No custody burden | A hypothesis to confirm with a lawyer (`docs/custody-models.md`, "Custody reading") |

## Part 2: live demo, 3:00

Two Swissquote accounts, on two separate stacks. **Start on the first, finish on the second.**

| | **CH-0003, existing tokens** | **CH-0004, created live** |
| --- | --- | --- |
| App (start here) | `http://localhost:5175` | `http://localhost:5173` |
| Login | `CH-0003` / `demo0003` | `CH-0004` / `pitch0004` |
| Trusted-contact console | `5176` | `5174` |
| Client Wallet (opens by itself) | `5290` | `5190` |
| Network | signet and Sepolia, old data | regtest, fresh data |
| Re-KYC (recovery) | `Martin`, `1992-03-21`, `246810` | `Keller`, `1994-07-12`, `135790` |

Do **not** open ports 4000, 5180, 5183 or 5184: they belong to another running session.

**Before the talk (not on stage)**
1. Both stacks are running (ports above). Check each app loads.
2. On the CH-0004 stack, open the contact console (`5174`), create the contact's identity, keep its public key at hand, and keep that tab open.
3. Do one full dry run of **both** stacks with Touch ID. The CH-0003 passkey was created on another port; it should work (the WebAuthn identifier is `localhost`), but I did not test it. The first opening of the crypto area for CH-0004 creates its passkey.
4. Record a video of the full run as a backup.

**On stage**

| Time | Action | What to say |
| --- | --- | --- |
| 2:00 | **CH-0003 (5175)**: log in, open Crypto: "Crypto is locked". Touch ID. The tokens appear | "The password alone opens nothing: the server asks for the client's biometrics. Here are the tokens of an existing wallet." |
| 2:25 | **CH-0004 (5173)**: log in, Crypto, "Create my wallet", paste the contact's key, Touch ID, the phrase appears once, send the public key | "A new client creates a wallet. The seed is made on their own device and shown once. The bank only receives public keys." |
| 3:15 | Fund it: `npm run regtest -- fund <address> 0.5`, then reload. Send, sign in the Client Wallet (point at the confirmation screen) | "That is A: the client signs in their own wallet, which shows exactly what leaves." |
| 3:50 | Wallet: "Simulate losing this device". Second profile: "I lost my wallet", re-KYC, new wallet, Swissquote signs, the contact signs in the console | "Now the client loses everything. Swissquote verifies identity and signs; the contact signs separately." |
| 4:30 | Broadcast: **the network refuses it** (`non-BIP68-final`). Then `npm run regtest -- mine 6` and broadcast again: accepted | "That is B: before the delay, Bitcoin itself says no. After the delay, the funds move." |
| 4:50 | Closing line | "Create, sign, lose it, recover. Self-custody, with a Swiss bank one step away." |

This is more than 3 minutes if everything runs live. **Cut in this order**: send (3:15), then the fund step by funding before you go on stage, then the CH-0003 part. Do not cut the refused broadcast: it is the proof of B.

**If something breaks**: play the recorded video. Do not debug on stage.

## Likely questions

- **A Swissquote employee with bad intentions tries to open my crypto area from their own PC?** Their biometrics unlock *their* key, not mine. The server checks a signature against the public key registered for my account, so it refuses. Two limits, said plainly: the first passkey is registered with the session alone, so enrol it right after creating the account; and the "I lost my device" path gives a limited level after a re-KYC (mocked here: name, birth date, code), where production needs real identity checks. And an insider who **controls the bank server** can bypass the lock, because it is a server rule (`bank-mock/src/cryptoLock.ts` says so). They still cannot move funds from my wallet: the key is on my device behind its own biometrics, and a recovery needs the contact and the delay.
- **You said you looked at MPC and a smart wallet: why not just use them?** MPC cannot enforce a delay on-chain: Swissquote and a partner can sign immediately, and the delay is a rule in software they run. A smart wallet exists only on Ethereum, so it cannot cover Bitcoin. We use one (a Safe) on Ethereum. The security gain of MPC against a stolen device is real, and we say so: a stolen seed lets a thief spend at once in our design.
- **What if Swissquote disappears?** On Bitcoin, the Emergency exit in the Client Wallet reads the coins from the chain and signs with the client's key alone, without the site or the bank server (`etape-41`, reported 5 of 5, not re-run). It needs the device with its wallet. If the client loses the device and Swissquote is gone, the funds are lost (stated in the README). Ethereum has no exit kit yet.
- **Can the client change their trusted contact?** Yes on Bitcoin: it changes the script, so the coins move to a new address and the delay restarts (`etape-43`).
- **Is Swissquote custodian?** Alone, it can move nothing. With the contact, it can after the delay, to any destination (the grey zone, `docs/custody-models.md`). The client resets the delay by spending.
- **Does it make money?** Not on fees alone at our illustrative values (break-even about 2,730 retained clients). The case rests on Swissquote's real volumes and on the strategic value of keeping the client.
- **Is the gasless real?** Real, through Candide's public paymaster (a third party). No abuse control of our own.
- **Compliant dApp?** Not implemented. The wallet decodes operations in plain language and refuses what it cannot explain.
- **Why does the repository differ from the demo?** The submission is the state pushed at 09:48 and 09:49. After 10:00, we added the key-pasting fix and a demo client, and merged the biometric-lock branch locally. Nothing was pushed or backdated.
