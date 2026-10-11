# Swissquote · self-custody wallet (Bitcoin + Ethereum) with two-guardian recovery

> "The bank builds the tool, but never holds the keys."

The client logs in to their Swissquote e-banking (simulated, styled after the Swissquote platform and app, in desktop and phone layouts), opens the **Crypto** tab and creates their wallet. The secret phrase is generated in **their own** "Client Wallet", a separate app that stands for a hardware wallet or a phone app: the bank only receives public keys. **One phrase, two accounts**: Bitcoin and Ethereum (USDC). The client spends alone, at any time, after confirming in their wallet. If the client loses their key, **Swissquote and a trusted contact chosen by the client** can together recover the funds to a new key, but only after a delay. Swissquote does not enforce these rules: Bitcoin consensus or an on-chain contract does.

| | Bitcoin (signet / regtest) | Ethereum (Sepolia) |
| --- | --- | --- |
| Account | P2WSH, Miniscript: `or( pk(CLIENT), and( pk(SWISSQUOTE), and( pk(TRUSTED), older(D) ) ) )` | **Safe** owned by the client's key + **Candide recovery module** (guardians Swissquote and trusted contact, threshold 2) |
| Who enforces the rules | Bitcoin consensus | The Safe and the recovery module contracts |
| Recovery | Swissquote + contact sign a transaction of coins **unmoved for D blocks** | Swissquote + contact sign (EIP-712) a request; the new key becomes owner **after the delay** |
| How the client blocks a recovery | **Refresh**: move the coins before D | **Cancel** the pending recovery during the delay |
| Network fees | Paid by the client in BTC | **Gasless**: 0 ETH on any account, fees paid by a paymaster (ERC-4337) |
| Demo delay / target | D = 6 blocks / about 6 months (≈ 26,000 blocks, assumption) | 3 minutes (module instance) / 7 or 14 days (existing instances) |

Why this model rather than custodial, seed phrase, MPC, smart account alone or Shamir split: [`docs/custody-models.md`](docs/custody-models.md).
Who can steal, block or move the funds, chain by chain: [`docs/threat-model.md`](docs/threat-model.md).
Travel Rule, ownership proof and whether Swissquote is the sending institution: [`docs/travel-rule.md`](docs/travel-rule.md).
Business case (formula and explicit assumptions, no Swissquote figure): [`docs/business-case.md`](docs/business-case.md).

## Gasless on Ethereum: how it works

The client never needs ETH, and neither do the guardians.

1. The app builds an **ERC-4337 UserOperation** for the client's Safe (`SafeAccountV0_3_0`, EntryPoint v0.7, `abstractionkit` 0.4.3).
2. Candide's **public paymaster** (no API key) agrees to sponsor it; Candide's **public bundler** (`https://api.candide.dev/public/v3/11155111`) submits it to Sepolia.
3. The Client Wallet decodes the operation **itself** and shows it in plain language ("Send 1 USDC to 0x8243…86Ee", "paid by a sponsor"). It **refuses to sign** any call it cannot decode, and flags unlimited USDC approvals and unknown modules.
4. Activation is one sponsored operation: it deploys the Safe, enables the recovery module, adds both guardians and sets threshold 2.
5. During a recovery, the guardians only sign **EIP-712 typed data** off-chain. A Safe of the client's **new** key relays their signatures, also sponsored.

The paymaster is a **third party (Candide), not Swissquote**. Its public policy and abuse limits are Candide's and unknown to us; no abuse limit of our own is implemented. A private sponsorship policy would let Swissquote set the rules (or pay). Without a paymaster, the owner's key still controls the Safe: the same operations can be paid in ETH (**not tested**).

On-chain evidence, all with 0 ETH on the Safe: activation [0xd943…7eca](https://sepolia.etherscan.io/tx/0xd943777d7bc9fcceba6c586d7047e96e3f82f3ea84091c9f66f22d2e18617eca), 1 USDC sent from the interface [0x457f…6963](https://sepolia.etherscan.io/tx/0x457f87501218278910983cc9097b62f2a8e4bc732cc72954221ad7cfab686963), recovery started [0x5586…3734](https://sepolia.etherscan.io/tx/0x5586fb5e0b0c8580087df031ecae70416fc39cdc7eb8f24f042c0549345e3734) and completed [0x988c…c0bc](https://sepolia.etherscan.io/tx/0x988c75c2411ec1ac8fa8e6fe193569fd881d361d6cde3571739370aa5e49c0bc), hostile recovery cancelled by the owner [0x41ad…5610](https://sepolia.etherscan.io/tx/0x41ad66d288233fb54ee6961dbce5136cba1be20ca3f17bdbba64ca0091295610) (steps 16 to 18).

## Real or mocked

| Component | Status | Detail |
| --- | --- | --- |
| Miniscript policy, addresses, PSBT, `older(D)` delay | **Real** | Reference compiler (sipa), `@bitcoinerlab/descriptors`, `@scure/btc-signer`. No home-made cryptography |
| Bitcoin node | **Real** | bitcoind 29 on regtest (Docker); signet through the blockstream.info Esplora API (cached in the browser, last known data shown if rate-limited) |
| Signet transactions | **Real** | Client spend [9203045e…](https://blockstream.info/signet/tx/9203045ed6d150a225821dff8c4287601f94d0c065ec975a795e92f637e6d248); Swissquote + trusted-contact recovery rejected before D (`non-BIP68-final`), then broadcast at D: [d26b94de…](https://blockstream.info/signet/tx/d26b94de30f36cbfa8b1a7f39976bf74a09e7afafda09b7a66a916b37326c519) |
| **Ethereum account** (Safe + Candide recovery module v0.0.1) | **Real**, Sepolia | `packages/evm/` (no key). Safe owned by the client's EOA `m/44'/60'/0'/0/0`, derived from the **same phrase** as Bitcoin. Activation, USDC send, recovery, cancellation from the interface. Activity (USDC transfers, module events) read on-chain |
| **Gasless** (ERC-4337 bundler + paymaster) | **Real**, third party | Candide public bundler and paymaster, no API key, 0 ETH on the Safe, the client and the guardians (see above) |
| USDC | **Real** test token | Circle's test USDC on Sepolia (`0x1c7D…7238`), from Circle's faucet |
| Bank app | **Real** (wallet) / **mocked** (bank) | `client/`: simulated Swissquote-style e-banking (public "Markets" page, login, home, CHF accounts), real Crypto tab with a network selector (Bitcoin / Ethereum, MetaMask-style). No private key, only public keys, PSBTs and unsigned UserOperations |
| **Client Wallet** | **Reference implementation** | `client-wallet/`: separate app (own process and storage) standing for the client's hardware wallet or phone app. Phrase generated by `@scure/bip39`, shown once, then **encrypted with a key from the device's biometrics** (a passkey of the wallet, WebAuthn PRF extension → HKDF → AES-256-GCM, `node:crypto`); biometrics required for every signature; older PIN-protected wallets are migrated. Signs only after a confirmation screen it builds itself (Bitcoin: outputs, amounts, fee, path; Ethereum: decoded calls); API closed to other origins |
| Real external signer | **Real** | Bitcoin Core 29 (`walletprocesspsbt`), validated on regtest |
| Command-line signer | **Test tool** | `tools/client-signer`: signer used by the validation scripts (reads the phrase at run time and stores nothing) |
| Swissquote backend (guardian) | **Mocked**, separate process | `bank-mock/`: own seed in its own storage (Bitcoin key and EVM guardian address), mocked re-KYC (test files). Signs only recoveries towards a new key of the same client: Bitcoin PSBT, or EIP-712 request for a Safe it recomputed itself |
| E-banking login, CHF accounts and transactions, re-KYC | **Mocked** | Hard-coded test clients (`bank-mock/src/bank.ts`, `kyc.ts`) |
| Market prices (BTC, USDC in CHF) and charts | **Real** feed / **simulated** fallback | CoinGecko, served and cached by bank-mock; "simulated rate" shown if the feed is down. Test coins are valued at the mainnet price, for display only |
| Trusted-contact console | **Real** (logic), demo | `guardian-console/`: creation of the contact's identity (phrase shown once; Bitcoin key and Ethereum address from it), decoding and signing (PSBT, or EIP-712 after checking on-chain that the contact is a guardian of the account); the phrase is never stored |
| High-value amounts | **Real** (WebAuthn, `@simplewebauthn`) | Bank login by client ID + mocked password. **Above 0.2 BTC**: passkey re-authentication with Swissquote (recorded, alert sent to the client), then, in the Client Wallet, retyping the last 6 characters of the destination address (enforced by the wallet's server). **Ethereum/USDC: no threshold configured** |
| History and fees | **Real** | Bitcoin history read from the chain (Esplora on signet, watch-only bitcoind wallet on regtest); fees estimated by the network (Economy / Normal / Fast). Ethereum: no fee for the client (sponsored) |
| Client alerts | **Real** (monitoring) / **simulated email** | bank-mock watches Bitcoin accounts (coin soon or already spendable by Swissquote + contact, with a countdown) and alerts immediately when Swissquote signs a recovery (Bitcoin or Ethereum). Bell in the app and simulated email (`bank-mock/data/outbox.log`) |
| Address ownership proof | **Real**, Bitcoin | Challenge issued by bank-mock, signed by the Client Wallet (BIP-322 "simple", `bip322-js`), verified in strict mode. What is proved is detailed below |
| Swissquote crypto account and transfers (Travel Rule) | **Mocked** (ledger) / **real** (on-chain, regtest) | Bitcoin only. Swissquote only sends to the wallet after an **ownership proof** signed automatically by the Client Wallet; deposits are credited only if they come from a wallet registered to the client. Ethereum: "Transfer (soon)" |
| Recovery without copy-paste | **Real** | Swissquote relays the request to the trusted contact through a link; the contact signs in their console and sends the signature back; Swissquote checks it comes from the registered contact. Manual exchange remains available |
| "Attacks" panel | **Real**, regtest demo | Bitcoin scenarios run against bitcoind with throw-away seeds (`scripts/attacks/`). The Ethereum refusals are proven by script (step 16) |
| Languages | **Real** | English by default; French, German, Italian on the public site and app frame; crypto screens in English and French; Client Wallet and console in English |
| Taproot, compliant dApp, DeFi | **Out of scope** | Not developed (see "Perspectives") |

## Run the demo

Prerequisites: Node 24, Docker (regtest only), a browser and device whose biometrics support the WebAuthn PRF extension (the Client Wallet refuses to create a wallet otherwise).

```bash
npm install
npm run regtest:up      # bitcoind 29 regtest in Docker
npm run demo            # bank :5173 · trusted-contact console :5174 · Client Wallet :5180 · bank-mock :4000 · attacks :4200
```

On the real signet network: `npm run demo:signet` (no Demo tab), or `npm run demo:signet:ports` (app :5183, console :5184) when 5173/5174 are taken. You need signet BTC from a faucet. **Ethereum always runs on the real Sepolia**, in every mode. The Ethereum validations used `demo:signet:ports`.

If a Vite port is already taken, the console takes the next one (shown in the terminal). Fixed ports are configurable (`.env.example`).

### Demo walkthrough: Bitcoin

1. **The trusted contact** opens the console (http://localhost:5174), clicks "Create my trusted-contact identity", writes down their phrase and sends their public key to the client.
2. **The client** goes through the public "Markets" page → "Login" (http://localhost:5173): client ID `CH-0003`, password `demo0003`. This is the **blank** demo client, with no Bitcoin account. `CH-0001` and `CH-0002` hold accounts created by the tests.
3. **Crypto → Create my wallet**: enter the contact's name and key, then "Create my wallet with the Client Wallet". In the Client Wallet window, enable biometrics: the wallet generates the phrase, shows it once, then encrypts it. The client confirms having written it down; only the public key goes back to the bank.
4. **Receive**: `npm run regtest -- fund <displayed address> 0.5`, then "Reload".
   **Ownership proof**: "Prove to Swissquote that I control this address". The Client Wallet shows the full challenge, the client signs, Swissquote verifies.
5. **Send**: prepare the transfer (plain-language simulation), "Sign with my Client Wallet", check the wallet's confirmation screen, sign, then broadcast. `npm run regtest -- mine 1` confirms the transaction.
6. **Wallet loss**: in the Client Wallet (http://localhost:5180), "Simulate losing this device". Then, in another browser profile, log in again and click "I lost my wallet". Mocked re-KYC for CH-0003: `Martin`, `1992-03-21`, `246810`. Then: new wallet, Swissquote signature, trusted contact's signature in their console (via the link), broadcast. **The network rejects it** (`non-BIP68-final`); after `npm run regtest -- mine 6`, broadcast again: accepted.
7. **Alerts**: the bell in the header signals a coin soon spendable by Swissquote + trusted contact (with a countdown), or a recovery signed by Swissquote (including on the old device).
8. **Demo**: the three attack buttons.

### Demo walkthrough: Ethereum (gasless)

1. **Crypto → network selector → Ethereum → "Add my Ethereum account"**: the Client Wallet derives the Ethereum address from the same phrase; the contact's Ethereum address is shown in their console; Swissquote recomputes the Safe address and registers it.
2. **"Activate my Ethereum account"**, then "Sign with my Client Wallet": the wallet lists the Safe deployment, "Enable the recovery module (Candide, 3 minutes delay)", both guardians and "paid by a sponsor". 0 ETH needed.
3. **Receive USDC** (Circle's Sepolia faucet), then **Send USDC**: the wallet shows "Send N USDC to 0x…" and signs; fees are sponsored.
4. **"Recover"** (key lost): re-KYC → new Client Wallet → its Ethereum address → "Request Swissquote's signature" → link for the contact, who signs in their console → "Fetch the trusted contact's signature" → "Start the recovery" → 3-minute countdown → "Complete the recovery". The old owner can press **"Cancel this recovery"** during the delay.

The logo is the official logo supplied by the team (`client/public/`). The interface adapts to the width: phone layout below 820 px (tab bar at the bottom), desktop layout above (menu, side rail, status bar).

## Evidence

Every claim in this repository points to a recorded run in `docs/validation/` (commands, raw output, screenshots).

| Command | What it proves |
| --- | --- |
| `npm run validate:1` / `validate:1:signet` | Policy, addresses, client spend through an external signer (client-signer, Bitcoin Core), signet |
| `npm run validate:2` | bank-mock, re-KYC, Swissquote refusals, bank-mock stopped → the client spends alone |
| `npm run validate:3` / `validate:3:signet` | Recovery rejected before D and accepted at D, refresh, real recovery on signet |
| `npm run test:attacks` | The three attacks and invariant 1 against consensus |
| `npm run validate:6:ui` (and `MOBILE=1 npm run validate:6:ui`) | Full Bitcoin journey in Chrome on an isolated stack, desktop and phone layouts: login, wallet creation through the Client Wallet, send confirmed in the wallet, wallet API closed to the bank, wallet loss and recovery (including the relay to the trusted contact) |
| `npm run validate:7` | Ownership proof (valid, and rejections: replay, altered message, other key, BIP-137 format, other client); blank client CH-0003 |
| `npm run validate:9` | History and fee estimation (regtest and real signet) |
| `npm run validate:10` | High-value amounts in the wallet (refusal without enhanced confirmation) and failure cases of the passkey step-up with Swissquote |
| `npm run validate:11` | Swissquote account ↔ wallet transfers: refusal without ownership proof or to a foreign address, withdrawal after proof, Travel Rule record, deposits credited or held depending on source |
| `npm run validate:12` | Relay to the trusted contact: request deposit and reading, signature return, foreign transaction refused |
| `npm run validate:8:pin` | Former PIN format: seed encrypted on disk, wrong PIN refused, lockout after 5 errors (step 8, before biometrics) |
| `npm run validate:8:alerts` | Alerts: threshold, no duplicates, recovery open, recovery signed by Swissquote, simulated email, isolation between clients |
| `npm run validate:8:signet -- create\|spend\|recover` | Interface journey on the real signet network |
| `cd scripts/feasibility && npm run gasless` / `npm run e2e` | **Ethereum by script, real Sepolia, 0 ETH**: sponsored deployment of Safe + module + 2 guardians; Swissquote alone refused; finalizing before the delay refused; recovery to a new key; old key refused; hostile recovery cancelled by the owner (steps 15-16) |
| `npm run validate:17` | **Ethereum account in the interface**: address from the same phrase, sponsored activation, refusal of an undecodable call, 1 USDC sent with no ETH |
| `npm run validate:18` | **Ethereum recovery in the interface**: Swissquote refuses without re-KYC, contact signs through the relay, start, delay, completion, leftover signatures invalidated |
| `npm run validate:19` / `validate:20` | Network selector and on-chain Ethereum activity; market prices, positions and charts |
| `npm run validate:21` / `validate:22` | Public Bitcoin API rate limit handled; public site and languages |
| `npm run validate:inv5` | No private key or seed in `client/` and its bundle (with positive control); `client/src` imports no EVM key derivation or signing |

The Chrome tests of steps 1 to 4 targeted the previous interface (commit `779a5bd`); they are replaced by `validate:6:ui`. The recorded outputs in `docs/validation/` are kept as observed, in the language of the time. Steps 25 to 36 (display, passkey wording, biometric unlock) were checked by typecheck, build and manual reading in the browser; the Chrome journeys above have **not** been rerun since step 24.

See also: [docs/threat-model.md](docs/threat-model.md), [docs/architecture.md](docs/architecture.md), [docs/ia.md](docs/ia.md).

## Who enforces what: authentication and high-value amounts

| Control | Enforced by | What it prevents | Limit |
| --- | --- | --- | --- |
| Bank login (client ID + password) | Swissquote (bank-mock), mocked | Access to the app | Does not protect funds: the keys are in the Client Wallet |
| Biometrics for every signature | **Client Wallet** (the phrase cannot be decrypted without the device's passkey) | Use of the wallet by someone else on the device | Reference implementation, not a secure element (see limits) |
| Passkey re-authentication above 0.2 BTC | Swissquote, through the app | Large transfer from a session opened by a third party; traceability and alert | **Not blocking if Swissquote is unreachable**, otherwise the client could no longer spend alone (invariant 4) |
| Last 6 characters of the address above 0.2 BTC | **Client Wallet** (the signer) | Blind signing, address substituted by a compromised app | An attacker who holds the seed bypasses any application-level control |
| Decoded confirmation screen, refusal of unknown calls (Ethereum) | **Client Wallet** | Blind signing of a malicious UserOperation (unknown module, unlimited approval) | **No threshold by amount on Ethereum yet** |
| On-chain difference by amount | **None**: on Bitcoin the `pk(CLIENT)` path does not know amounts | — | On Ethereum, a Safe module or guard could enforce an on-chain limit (perspective) |

## What the ownership proof proves (and what it does not)

Swissquote issues a single-use challenge (10 min) naming the client and address #i of their account. The Client Wallet signs it with its **client key** at index i. Swissquote recomputes that key from the registered xpub, without trusting the app, and verifies the signature in strict mode.

- **Proved**: the client holds the private key of their client key at index i (BIP-322 "simple" signature, verified for the P2WPKH address of that key). According to the policy registered by Swissquote, that key **alone** is enough to spend address #i (client path).
- **Not proved**: this is **not** a BIP-322 signature of the account's P2WSH address itself, because `bip322-js` does not handle P2WSH. The link between the key and the address relies on the descriptor Swissquote knows, not on a proof produced by the address script. The proof says nothing about the identity of the person holding the key: it is tied to the client through the bank session.
- **Ethereum**: no ownership proof yet (the transfers with the Swissquote account are Bitcoin only).

## Accepted limits

- **Swissquote disappears AND the client loses their key: funds are lost** (both chains). No path works without Swissquote if the client no longer has their key. Possible extension: a "client backup + trusted contact" path after a longer delay.
- **The trusted contact loses their key: recovery becomes impossible.** The client must replace them while they still have their key. Changing the contact is not implemented.
- **Custody grey zone.** Swissquote + trusted contact can take the funds, **to any destination**, if the client does not react: on Bitcoin, any coin unmoved for D blocks (observed in `npm run test:attacks`, attack 2); on Ethereum, the **whole account** if the client does not cancel during the delay. Mitigations: contact chosen by the client and unrelated to Swissquote, in-app warning and countdown, refresh (Bitcoin) or cancellation (Ethereum).
- **Bitcoin: refresh is mandatory.** To block any recovery, the client must move each coin before D: it costs fees, and activity becomes visible on-chain.
- **Ethereum: the client must notice a hostile recovery within the delay**, and Swissquote + contact can start recoveries repeatedly (griefing); each cancellation is currently sponsored.
- **Ethereum: dependence on third parties for gasless**: Candide's bundler and paymaster (public policy, unknown limits, no abuse limit of ours), public Sepolia node (rate limits, stale reads: the app reads state at the receipt's block). Without them, operations must be paid in ETH (not tested).
- **Candide recovery module v0.0.1**: after a recovery or a cancellation, `invalidateNonce` must be called (the app does it); removing a guardian does not cancel an ongoing recovery. 3-minute demo instance.
- **Few external wallets sign the Bitcoin script** (Miniscript with delay): Bitcoin Core (verified), Liana and some hardware wallets (announced, not verified). Sparrow most likely does not support it (GitHub issues #1700 open and #1757 declined; not verified by running Sparrow).
- **Privacy.** With P2WSH, every Bitcoin spend reveals the policy, hence the existence of the delay. On Ethereum, the guardians are readable on-chain.
- **Client Wallet**: the phrase file cannot be decrypted without the device's passkey, but the PRF secret and the decrypted phrase pass through the wallet's page and local process. In production, a secure element is needed (hardware wallet, phone enclave).
- **Alerts**: information only. They depend on Swissquote (Swissquote stopped = no more alerts), and the email is simulated. Protection remains the delay and the client's reaction.
- **Relay to the trusted contact**: the link is sent to the contact by the client (no notification or inbox yet); anyone with the link can read the request (amounts and addresses), but cannot spend.
- Re-KYC and bank session are mocked; `node:sqlite` is experimental in Node 24.

## Perspectives (not implemented)

- **Compliant dApp / DeFi** (bonus): a local demo dApp signed through the same decoded confirmation screen (decision taken: no WalletConnect).
- **Ethereum hardening**: threshold by amount (passkey step-up and on-chain limit through a Safe guard), private sponsorship policy run by Swissquote, Swissquote account ↔ Ethereum wallet transfers with ownership proof, alerts on a pending recovery.
- **Taproot.** `tr(CLIENT, {and(SWISSQUOTE, TRUSTED, older(D))})`: the client's spend goes through the key path and looks like an ordinary single-signature payment. It is cheaper and never reveals the existence of the delay. The ownership proof could then cover the account address itself. To be verified: the Taproot key depends on the script tree, and `bip322-js` only advertises plain key-path spending.

## Structure

```
packages/bitcoin/     policy, descriptors, PSBT, simulation, finalization (index.ts: no key; sign.ts/keys.ts: tools only)
packages/evm/         Safe address, sponsored UserOperations, decoding, on-chain reads (index.ts: no key; keys.ts: wallet, bank-mock, console only)
client/               bank app (Vite + React): public site, simulated e-banking, crypto wallet (Bitcoin + Ethereum), recovery, Demo · Attacks
client-wallet/        Client Wallet (reference implementation; own process and storage)
bank-mock/            mocked Swissquote guardian (separate process, own storage), market prices
guardian-console/     trusted-contact console
tools/                client-signer (signer for the test scripts), keygen
scripts/              validations, attacks, demo helpers, feasibility/ (Ethereum scripts on Sepolia)
docker/               bitcoind regtest
docs/                 validation/, threat-model, architecture, custody-models, travel-rule, business-case, ia
```
