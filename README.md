# Swissquote · self-custody wallet (Bitcoin and Ethereum) with two-guardian recovery

> "The bank builds the tool, but never holds the keys."

The client logs in to their Swissquote e-banking (simulated, styled after the Swissquote platform and app, in desktop and phone layouts), opens the **Crypto** tab and creates their wallet. The seed is generated in **their own** "Client Wallet", a separate app that stands for a hardware wallet or a phone app: the bank only receives public keys. One secret phrase gives two accounts, **Bitcoin** and **Ethereum (USDC)**, shown one network at a time. The client spends alone, at any time, after confirming in their wallet. If the client loses their key, **Swissquote and a trusted contact chosen by the client** can together move the funds to a new key, but only after a delay. These rules are not enforced by Swissquote: they are enforced by the chain.

**Bitcoin**: the rule is written in the script and enforced by consensus, **only for coins that have not moved for D blocks**.

```
or( pk(CLIENT), and( pk(SWISSQUOTE), and( pk(TRUSTED), older(D) ) ) )      P2WSH, Miniscript
```

Demo: D = 6 blocks. Target production value (assumption, parameter): about 6 months (≈ 26,000 blocks).

**Ethereum (Sepolia testnet)**: a **Safe** owned by the client's key, with Candide's recovery module: Swissquote and the trusted contact must both sign (threshold 2), then the contract waits for a delay (3 minutes in the demo) before the new key becomes owner. The owner can cancel a hostile recovery in the meantime. Fees are paid by Candide's public paymaster, so the client needs no ETH.

Why this model rather than custodial, seed phrase, MPC, smart account or Shamir split: [`docs/custody-models.md`](docs/custody-models.md).
Travel Rule, ownership proof and whether Swissquote is the sending institution: [`docs/travel-rule.md`](docs/travel-rule.md).
Business case (formula and explicit assumptions, no Swissquote figure): [`docs/business-case.md`](docs/business-case.md).

## Features

**For the client**
- **One wallet, two networks**: one secret phrase, generated in the Client Wallet and shown once, gives a Bitcoin account and an Ethereum (USDC) account, shown one network at a time.
- **Biometrics everywhere it matters**: the Client Wallet seed is encrypted with a secret released by the device biometrics (Touch ID, Face ID, Windows Hello; WebAuthn PRF). Every signature, policy change and wallet erase asks for it. The bank's **crypto part is locked** behind a passkey checked by Swissquote: a stolen password is not enough, and it relocks when the client leaves the tab.
- **Spend alone, at any time**: send, refresh (Bitcoin) and an **emergency exit** in the Client Wallet that spends without Swissquote, the site or the bank account.
- **Recover with Swissquote and a trusted contact**: re-KYC, a new Client Wallet, Swissquote's signature, the contact's signature in their own console (link relayed by Swissquote, no copy-paste), then the delay enforced by the chain (D blocks on Bitcoin, 3 minutes on the Ethereum demo, cancellable by the owner).
- **Change of trusted contact**, on Bitcoin (coins moved to the new rule) and on Ethereum (one operation that removes the old guardian, adds the new one, cancels any pending recovery and invalidates collected signatures).
- **High-value transfers** (above 0.2 BTC): passkey re-authentication with Swissquote, then biometrics and the last 6 characters of the address in the Client Wallet, one recipient at a time.
- **Swissquote account ↔ wallet transfers** under the Travel Rule, with an ownership proof signed in the Client Wallet.
- **Alerts**: bell and simulated email when a coin is about to become recoverable, when Swissquote signs a recovery, when the contact changes.

**Protections against a compromised bank app**
- The Client Wallet decodes everything itself before signing (Bitcoin outputs and path, Ethereum calls) and refuses what it cannot explain, any recovery-path PSBT, guardian changes other than the activation or a checked contact change, and a second request sent while one awaits confirmation.
- The account policy (trusted contact, Swissquote key, delay) is never saved silently: the Client Wallet shows the **contact's fingerprint**, which the contact reads out from their console, and saves only after biometrics.
- **One Swissquote key per account** (Bitcoin and Ethereum): the scripts revealed on-chain and the guardian lists do not link Swissquote's clients to one another.
- The Client Wallet, bank-mock, the attack server and bitcoind listen on the loopback interface only; the regtest RPC relay of the app forwards only the methods it needs.

## Real or mocked

| Component | Status | Detail |
| --- | --- | --- |
| Miniscript policy, addresses, PSBT, `older(D)` delay | **Real** | Reference compiler (sipa), `@bitcoinerlab/descriptors`, `@scure/btc-signer`. No home-made cryptography |
| Bitcoin node | **Real** | bitcoind 29 on regtest (Docker); signet through the blockstream.info Esplora API |
| Signet transactions | **Real** | Client spend [9203045e…](https://blockstream.info/signet/tx/9203045ed6d150a225821dff8c4287601f94d0c065ec975a795e92f637e6d248); Swissquote + trusted-contact recovery rejected before D (`non-BIP68-final`), then broadcast at D: [d26b94de…](https://blockstream.info/signet/tx/d26b94de30f36cbfa8b1a7f39976bf74a09e7afafda09b7a66a916b37326c519) |
| Bank app | **Real** (wallet) / **mocked** (bank) | `client/`: simulated Swissquote-style e-banking (login, home with simulated chart, CHF accounts), real Crypto tab. No private key, only public keys and PSBTs |
| **Client Wallet** | **Reference implementation** | `client-wallet/`: separate app (own process and storage) standing for the client's hardware wallet or phone app. Seed generated by `@scure/bip39`, shown once, then **encrypted and unlocked with the device biometrics** (WebAuthn PRF, HKDF + AES-256-GCM); biometrics required for every Bitcoin and Ethereum signature; the PIN format of earlier wallets is only kept to migrate them to biometrics (step 36-37). Signs only after a confirmation screen (outputs, amounts, fee, path; for Ethereum it decodes the operation **itself** and refuses what it cannot explain, and any change of recovery guardians outside the initial activation). The account policy sent by the bank (trusted contact, Swissquote key, delay) is **shown with the contact's fingerprint and saved only after biometrics**. API closed to other origins, loopback interface only |
| Real external signer | **Real** | Bitcoin Core 29 (`walletprocesspsbt`), validated on regtest |
| Command-line signer | **Test tool** | `tools/client-signer`: signer used by the validation scripts (reads the phrase at run time and stores nothing) |
| Swissquote backend (guardian) | **Mocked**, separate process | `bank-mock/`: own seed in its own storage, one derived key per client account, mocked re-KYC (test files, locked after 5 wrong codes), signs only recoveries towards another account of the same client and with a fee under 5 % |
| E-banking login, CHF accounts and transactions, re-KYC, BTC/CHF rate | **Mocked** | Hard-coded test clients (`bank-mock/src/bank.ts`, `kyc.ts`) |
| Trusted-contact console | **Real** (logic), demo | `guardian-console/`: creation of the contact's identity (phrase shown once), decoding and signing; the phrase is never stored |
| Authentication and high-value amounts | **Real** (WebAuthn, `@simplewebauthn`) / **mocked** (login) | Bank login by client ID and mocked password (the passkey login was removed in step 27); the **crypto part is locked** until a passkey (biometrics) is verified by bank-mock, and relocks when the client leaves it. **Above 0.2 BTC**: passkey re-authentication with Swissquote (recorded, alert sent to the client), then, in the Client Wallet, biometrics **and** retyping the last 6 characters of the destination address (check enforced by the wallet's server) |
| History and fees | **Real** | Account history (received, sent, refresh, recovery) read from the chain: Esplora on signet, watch-only bitcoind wallet (public descriptors) on regtest. Fees estimated by the network (Economy / Normal / Fast presets), never below 1 sat/vB |
| Client alerts | **Real** (monitoring) / **simulated email** | bank-mock watches accounts (regtest every 30 s, signet every 15 min, as the public Esplora API allows about 700 requests per hour): coin soon or already spendable by Swissquote + trusted contact, and an immediate alert when Swissquote signs a recovery. Bell in the app and simulated email (`bank-mock/data/outbox.log`) |
| Address ownership proof | **Real** | Challenge issued by bank-mock, signed by the Client Wallet (BIP-322 "simple", `bip322-js`), verified in strict mode. What is proved is detailed below |
| Swissquote crypto account and transfers (Travel Rule) | **Mocked** (ledger) / **real** (on-chain, regtest) | Assets held in custody by Swissquote (today's offer); "Transfer" to the wallet: Swissquote only sends after an **ownership proof**, requested automatically and signed in the Client Wallet (biometrics), from a bitcoind omnibus wallet; deposits are credited only if they come from a wallet registered to the client. Regtest only |
| Recovery without copy-paste | **Real** | Swissquote relays the request to the trusted contact through a link; the contact signs in their console and sends the signature back. Manual PSBT exchange remains available |
| "Attacks" panel | **Real**, regtest demo | Scenarios run against bitcoind with throw-away seeds (`scripts/attacks/`) |
| **Ethereum account** (Sepolia testnet) | **Real** | Safe owned by the client's EOA (same phrase as Bitcoin, derived in the Client Wallet), Candide recovery module (Swissquote + contact, threshold 2, 3-minute delay in the demo). From the interface: activation, USDC balance and send, activity read on-chain, recovery (re-KYC, EIP-712 signatures of Swissquote and the contact relayed through bank-mock, countdown, completion), cancellation by the owner. `packages/evm`, steps 15-19 |
| Gasless | **Real**, third party | Operations are sponsored by Candide's **public** paymaster (ERC-4337): the client holds no ETH. Swissquote does not pay and has no abuse control of its own; a production paymaster policy is not designed here |
| Languages | **Real** (partial) | Public site and bank frame in English, French, German and Italian (step 22); crypto screens also in French (step 24, German and Italian stay in English); Client Wallet and guardian console in English |
| Change of trusted contact | **Real** | Bitcoin: coins moved by the client alone to the policy with the new contact, then Swissquote's registry and the wallet's policy updated (step 43). Ethereum: one operation checked by the Client Wallet against the guardians it reads on-chain (step 58) |
| Swissquote keys | **Real** (derivation) / **mocked** (storage) | One Bitcoin account key and one Ethereum guardian address per client account, derived from Swissquote's seed (hardened index from the client's public key). Accounts registered before step 56 keep the former common key |
| Compliant dApp interaction, DeFi, Taproot | **Not implemented** | No code in the repository (see "Perspectives") |

## Run the demo (three commands)

Prerequisites: Node 24, Docker.

```bash
npm install
npm run regtest:up      # bitcoind 29 regtest in Docker
npm run demo            # bank :5173 · trusted-contact console :5174 · Client Wallet :5180 · bank-mock :4000 · attacks :4200
```

Before a demo on a new machine, check real biometrics once: `npm run check:touchid` opens Chrome, creates a wallet with Touch ID and signs a regtest transaction (three touches). The automated tests use Chrome's virtual authenticator.

`npm run regtest:up` keeps the regtest chain when it recreates the container; `npm run regtest:down` deletes it.

If a Vite port is already taken, the console takes the next one (shown in the terminal). Fixed ports are configurable (`.env.example`).

### Demo walkthrough

1. **The trusted contact** opens the console (http://localhost:5174), clicks "Create my trusted-contact identity", writes down their phrase and sends their public key to the client.
2. **The client** logs in to the bank (http://localhost:5173): client ID `CH-0003`, password `demo0003`. Blank demo clients, with no Bitcoin account: `CH-0003` (tests and rehearsals), `CH-0004` / `pitch0004` (pitch), `CH-0005` / `video0005` (video), `CH-0006` / `second0006` (second run in front of the jury). `CH-0001` and `CH-0002` hold accounts created by the tests.
3. **Crypto**: the crypto part is locked; "Enable biometrics" (first time) or "Unlock with biometrics". **Create my wallet**: enter the contact's name and key, then "Create my wallet with the Client Wallet". In the Client Wallet window, "Generate my secret phrase" (biometrics): the wallet shows the phrase once, then encrypts it. The client confirms having written it down; only the public key goes back to the bank. The wallet then shows the **account policy**: the client checks that the contact's fingerprint is the one shown in the contact's console, and confirms with biometrics.
4. **Receive**: `npm run regtest -- fund <displayed address> 0.5`, then "Reload".
   **Ownership proof**: "Prove to Swissquote that I control this address". The Client Wallet shows the full challenge, the client signs, Swissquote verifies.
5. **Send**: prepare the transfer (plain-language simulation), "Sign with my Client Wallet", check the wallet's confirmation screen, sign, then broadcast. `npm run regtest -- mine 1` confirms the transaction.
6. **Wallet loss**: in the Client Wallet (http://localhost:5180), "Simulate losing this device" (biometrics required). Then, in another browser profile, log in again and click "I lost my device or my biometrics: recover my wallet". Mocked re-KYC for CH-0003: `Martin`, `1992-03-21`, `246810` (CH-0004: `Keller`, `1994-07-12`, `135790`; CH-0005: `Berger`, `1991-11-02`, `975310`; CH-0006: `Rossi`, `1993-04-18`, `864209`; 5 wrong codes lock the check for 15 minutes). Then: new wallet, Swissquote signature, trusted contact's signature in their console (via the link), broadcast. **The network rejects it** (`non-BIP68-final`); after `npm run regtest -- mine 6`, broadcast again: accepted.
7. **Alerts**: the bell in the header signals a coin soon spendable by Swissquote + trusted contact, or a recovery signed by Swissquote (including on the old device).
8. **Change of trusted contact**: Crypto → Security → "Change my trusted contact" (Bitcoin: name and public key of the new contact; Ethereum: name and address). The Client Wallet shows the old and the new contact before signing.
9. **Ethereum**: network selector → Ethereum → "Add my Ethereum account" (contact's Ethereum address from their console) → "Activate my Ethereum account" (signed in the Client Wallet, no ETH). Recovery from the "Recover" button, cancellation from the warning shown to the owner.
10. **Demo**: the three attack buttons.

On the real signet network: `npm run demo:signet` (no Demo tab). You need signet BTC from a faucet.

The logo is the official logo supplied by the team (`client/public/`). The interface adapts to the width: phone layout below 820 px (tab bar at the bottom), desktop layout above (menu, side rail, status bar). The whole interface is in English.

## Evidence

Every claim in this repository points to a recorded run in `docs/validation/` (commands, raw output, screenshots).

| Command | What it proves |
| --- | --- |
| `npm run validate:1` / `validate:1:signet` | Policy, addresses, client spend through an external signer (client-signer, Bitcoin Core), signet |
| `npm run validate:2` | bank-mock, re-KYC, Swissquote refusals, bank-mock stopped → the client spends alone |
| `npm run validate:3` / `validate:3:signet` | Recovery rejected before D and accepted at D, refresh, real recovery on signet |
| `npm run test:attacks` | The three attacks and invariant 1 against consensus |
| `npm run validate:6:ui` (and `MOBILE=1 npm run validate:6:ui`) | Full journey in Chrome on an isolated stack, desktop and phone layouts: login, wallet creation through the Client Wallet, send confirmed in the wallet, wallet API closed to the bank, wallet loss and recovery (including the relay to the trusted contact) |
| `npm run validate:7` | Ownership proof (valid, and rejections: replay, altered message, other key, BIP-137 format, other client); blank client CH-0003 |
| `npm run validate:9` | History (classification and amounts of each transaction type, on regtest; real receive on signet) and fee estimation (regtest and real signet) |
| `npm run validate:10` | High-value amounts in the wallet (refusal without enhanced confirmation) and failure cases of the passkey step-up with Swissquote |
| `npm run validate:11` | Swissquote account ↔ wallet transfers: refusal without ownership proof or to a foreign address, withdrawal after proof, Travel Rule record, deposits credited or held depending on source |
| `npm run validate:12` | Relay to the trusted contact: request deposit and reading, signature return, foreign transaction refused |
| `npm run validate:37` | Biometric vault of the Client Wallet (server side, step 37) |
| `npm run validate:38` | Crypto lock: crypto routes refused with the password session alone, opened by a passkey or (recovery only) by re-KYC |
| `npm run validate:40` / `validate:41` / `validate:42` | Wallets belong to the device; emergency exit of the Client Wallet without Swissquote; biometrics migration of an old wallet |
| `npm run validate:43` | Bitcoin change of trusted contact: coins moved to the new rule, Swissquote registry and wallet policy updated |
| `npm run validate:44` | Biometrics (WebAuthn PRF) in Chrome: wallet created, same secret on each request, real regtest signature, other salt or removed authenticator refused |
| `npm run validate:46` | Loopback-only servers (refused from the LAN address), foreign `Host` refused, erasing a wallet requires biometrics |
| `npm run validate:47` | Account policy confirmed in the Client Wallet: contact fingerprint shown, substituted contact key flagged and refused, biometrics required |
| `npm run validate:48` | Ethereum: guardian changes and thresholds below 2 refused by the wallet, initial activation accepted (offline) |
| `npm run validate:49` | Regtest RPC relay: only the app's methods; `sendtoaddress` on the custody wallet, `stop`, foreign origin refused |
| `npm run validate:50` | Wallet hardening: no way back to a PIN, high value to a single recipient, no request substitution during confirmation |
| `npm run validate:52` | bank-mock: JSON only, concurrent withdrawals, recovery fee cap, re-KYC lockout (0/4 on the code before the fix) |
| `npm run validate:53` | Trusted-contact console keeps working when an unreadable request is pasted |
| `npm run validate:54` | Ethereum on the real Sepolia, from the interface, no ETH, with biometrics: activation, refusals on the deployed Safe, Swissquote + contact recovery after 3 min, invalidation (about 10 min). Replaces `validate:17`/`18`, which typed a PIN |
| `npm run validate:56` | One Swissquote key per account: distinct keys for two clients, registration recomputes the key, recovery signed and accepted at D, accounts registered before keep the former key |
| `npm run validate:57` | A change of trusted contact in progress survives crossing the 820 px phone/desktop threshold (failed before the fix) |
| `npm run validate:58` | Ethereum change of trusted contact on the real Sepolia: wallet screen with old and new address, guardians on-chain, Swissquote registry, relay accepts only the new contact |
| `npm run validate:61` | The crypto lock does not relock during a Client Wallet request (account registration refused before the fix); demo clients CH-0004 to CH-0006 |
| `npm run check:touchid` | **Manual**: real Touch ID in Chrome creates a wallet and signs (not run by the automated suite) |
| `npm run validate:8:alerts` | Alerts: threshold, no duplicates, recovery open, recovery signed by Swissquote, simulated email, isolation between clients |
| `npm run validate:8:signet -- create\|spend\|recover` | Interface journey on the real signet network |
| `npm run validate:inv5` | No private key or seed in `client/` and its bundle (with positive control) |

The Chrome tests of steps 1 to 4 targeted the previous interface (commit `779a5bd`); they are replaced by `validate:6:ui`. The recorded outputs in `docs/validation/` are kept as observed, in the language of the time (French before the translation).

See also: [docs/threat-model.md](docs/threat-model.md), [docs/architecture.md](docs/architecture.md), [docs/qa-technique.md](docs/qa-technique.md) (technical questions), [docs/ia.md](docs/ia.md), pitch slides in [docs/slides/](docs/slides/).

## Who enforces what: authentication and high-value amounts

| Control | Enforced by | What it prevents | Limit |
| --- | --- | --- | --- |
| Crypto lock: passkey (WebAuthn, user verification required) on top of the password session | Swissquote (bank-mock) | Use of the crypto part (custody withdrawals, ownership proofs, registering a wallet) with a stolen password alone | Does not protect funds: the keys are in the Client Wallet |
| Passkey re-authentication above 0.2 BTC | Swissquote, through the app | Large transfer from a session opened by a third party; traceability and alert | **Not blocking if Swissquote is unreachable**, otherwise the client could no longer spend alone (invariant 4) |
| Biometrics + last 6 characters of the address above 0.2 BTC | **Client Wallet** (the signer) | Blind signing, address substituted by a compromised app | An attacker who holds the seed bypasses any application-level control |
| On-chain difference by amount | **None on Bitcoin**: the `pk(CLIENT)` path does not know amounts | — | On EVM, a Safe module or guard can enforce an on-chain limit (perspective) |

## What the ownership proof proves (and what it does not)

Swissquote issues a single-use challenge (10 min) naming the client and address #i of their account. The Client Wallet signs it with its **client key** at index i. Swissquote recomputes that key from the registered xpub, without trusting the app, and verifies the signature in strict mode.

- **Proved**: the client holds the private key of their client key at index i (BIP-322 "simple" signature, verified for the P2WPKH address of that key). According to the policy registered by Swissquote, that key **alone** is enough to spend address #i (client path).
- **Not proved**: this is **not** a BIP-322 signature of the account's P2WSH address itself, because `bip322-js` does not handle P2WSH. The link between the key and the address relies on the descriptor Swissquote knows, not on a proof produced by the address script. The proof says nothing about the identity of the person holding the key: it is tied to the client through the bank session.

## Accepted limits

- **Swissquote disappears AND the client loses their key: funds are lost.** No path works without Swissquote if the client no longer has their key. Possible extension: a "client backup + trusted contact" path after a longer delay.
- **The trusted contact loses their key: recovery becomes impossible**, until the client replaces them while they still have their key (Bitcoin: new policy and coin move, step 43; Ethereum: guardian replaced in one operation, step 58). On Ethereum the Client Wallet cannot tell which guardian is Swissquote: the client must recognise the removed address as their contact's.
- **Custody grey zone.** Swissquote + trusted contact can spend, **to any destination**, any coin that has not moved for D blocks. Observed in `npm run test:attacks` (attack 2, "grey zone" line). Mitigations: contact chosen by the client and unrelated to Swissquote, in-app warning before the deadline, refresh by the client. Bitcoin cannot restrict the destination.
- **Refresh is mandatory.** To block any recovery, the client must move each coin before D: it costs fees, and activity becomes visible on-chain.
- **Few external wallets sign this kind of script** (Miniscript with delay): Bitcoin Core (verified), Liana and some hardware wallets (announced, not verified). Sparrow most likely does not support it (GitHub issues #1700 open and #1757 declined; not verified by running Sparrow).
- **Privacy.** With P2WSH, every spend reveals the policy, hence the existence of the delay. Since step 56 each account has its own Swissquote key, so revealed scripts no longer link Swissquote's clients; accounts registered before keep the former common key until the client moves to a new account.
- **Trusted contact fingerprint.** The Client Wallet shows it before saving a policy; the protection against a substituted key relies on the client comparing it with the contact by another channel.
- **Tests run with a virtual authenticator.** Biometrics are validated in Chrome with a virtual WebAuthn authenticator (PRF). Real Touch ID is checked with `npm run check:touchid`, which needs the user's finger and is not part of the automated suite.
- **No Taproot, no compliant dApp interaction, no DeFi**: see "Perspectives". Ethereum runs on the Sepolia testnet only, with a 3-minute demo delay and a public third-party paymaster (no abuse control of ours, no production policy).
- **Ethereum recovery module is version 0.0.1** (deployed by Candide, without the 2026 audit fixes). After a recovery, the new owner invalidates the guardians' leftover signatures (`invalidateNonce`, prepared automatically, signed in the Client Wallet). Removing a guardian does not cancel an ongoing recovery: the change of trusted contact therefore cancels it in the same operation. Both pitfalls come from the exploration on a Sepolia fork (branch `archive/exploration-etape-0`).
- **Client Wallet unlock**: the seed is encrypted with a key derived from the device biometrics (WebAuthn PRF). Its strength depends on the device and browser; this is a reference implementation, and a production wallet should rely on a secure element (hardware wallet, phone enclave). The older PIN format (scrypt, 6 digits) is within reach of an offline exhaustive search and is kept only to migrate old wallets.
- **Alerts**: information only. They depend on Swissquote (Swissquote stopped = no more alerts), and the email is simulated. Protection remains the consensus-enforced delay and the client's refresh.
- **Relay to the trusted contact**: the link is sent to the contact by the client (no notification or inbox yet); anyone with the link can read the request (amounts and addresses), but cannot spend.
- Re-KYC and bank session are mocked; `node:sqlite` is experimental in Node 24.

## Perspectives (not implemented)

- **Ethereum beyond the demo.** Mainnet or an L2 instead of Sepolia, a recovery delay of days instead of 3 minutes, and a paymaster policy run or chosen by Swissquote (who is sponsored, how abuse is limited). The semantics differ from Bitcoin: the owner **cancels** an ongoing recovery, instead of refreshing their coins.
- **Compliant dApp interaction.** An approved list of contracts, sanctions screening and plain-language simulation before signing. The Client Wallet already decodes USDC transfers and refuses operations it cannot explain, but there is no dApp connection.
- **Taproot.** `tr(CLIENT, {and(SWISSQUOTE, TRUSTED, older(D))})`: the client's spend goes through the key path and looks like an ordinary single-signature payment. It is cheaper and never reveals the existence of the delay. The ownership proof could then cover the account address itself. To be verified: the Taproot key depends on the script tree, and `bip322-js` only advertises plain key-path spending.

## Structure

```
packages/bitcoin/   policy, descriptors, PSBT, simulation, finalization (index.ts: no key; sign.ts/keys.ts: tools only)
packages/evm/       Safe address, sponsored operations, state and activity read on-chain, decoding (index.ts: no key; keys.ts: wallet, bank-mock and console only)
client/             bank app (Vite + React): simulated e-banking, crypto wallet, recovery, Demo · Attacks
client-wallet/      Client Wallet (reference implementation; own process and storage)
bank-mock/          mocked Swissquote guardian (separate process, own storage)
guardian-console/   trusted-contact console
tools/              client-signer (signer for the test scripts), keygen
scripts/            validations, attacks, demo helpers
docker/             bitcoind regtest
docs/               validation/, slides/ (pitch), threat-model, architecture, qa-technique (questions), ia
```
