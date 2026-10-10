# Architecture

Three principles:
1. **No private key in the app**: it only handles public keys and PSBTs.
2. **The spending policy is enforced by Bitcoin consensus**, not by Swissquote.
3. **Each guardian is a separate process or person**, with its own storage.

```mermaid
flowchart LR
  classDef reel fill:#e3f6e8,stroke:#2e7d32,color:#1b3d1f
  classDef mock fill:#fff4d6,stroke:#b8860b,color:#4d3800
  classDef demo fill:#e3e8f2,stroke:#44546f,color:#1d2433

  subgraph Banque["Bank app (browser)"]
    APP["client/ (Vite + React)<br/>simulated e-banking + crypto wallet<br/>public keys + PSBTs"]:::reel
  end

  subgraph Appareil["Client's device"]
    WALLET["Client Wallet · client-wallet/<br/>reference implementation<br/>@scure/bip39 seed · confirmation screen"]:::demo
    WDB[("client-wallet/data<br/>seeds (600)")]:::demo
  end

  subgraph SQ["Swissquote (separate process)"]
    BANK["bank-mock/<br/>Swissquote guardian<br/>mocked re-KYC · own key"]:::mock
    DB[("bank-mock/data<br/>SQLite + seed (600)")]:::mock
  end

  subgraph TIERS["Trusted contact"]
    CONSOLE["guardian-console/<br/>decodes and signs<br/>phrase never stored"]:::reel
  end

  subgraph CHAIN["Bitcoin network"]
    NODE["bitcoind 29 regtest (Docker)<br/>signet via Esplora (blockstream.info)"]:::reel
  end

  ATT["scripts/attacks/server.ts<br/>'Attacks' panel (regtest demo)"]:::demo

  APP -- "window + postMessage:<br/>create · policy · PSBT to sign" --> WALLET
  WALLET -- "public key · signed PSBT<br/>(after confirmation)" --> APP
  WALLET --- WDB
  APP -- "public key, registration, re-KYC,<br/>recovery request (PSBT)" --> BANK
  BANK --- DB
  BANK -- "signed PSBT (Swissquote)" --> APP
  APP -- "PSBT to sign (link via bank-mock relay,<br/>or manual copy-paste)" --> CONSOLE
  CONSOLE -- "signed PSBT (trusted contact)" --> APP
  APP -- "finalizes and broadcasts;<br/>reads coins" --> NODE
  APP -- "starts a scenario" --> ATT
  ATT -- "demo transactions" --> NODE
```

Legend: green = real, yellow = mocked, grey-blue = reference implementation or demo tool.

The relay between the app and the trusted-contact console goes through bank-mock (`/relay`): the client deposits the PSBT signed by Swissquote, the contact opens it through a link (`?req=…`) and sends back their signature; bank-mock only accepts a signed version of the same transaction. If Swissquote is unavailable, the manual exchange remains.

Other signers: Bitcoin Core (`walletprocesspsbt`, validated) can replace the Client Wallet through the "Other external wallet (PSBT)" option; `tools/client-signer` serves the test scripts.

## Policy and spending paths

```mermaid
flowchart TD
  U["Coin on the account address<br/>wsh(andor(pk(S), and_v(v:pk(T), older(D)), pk(C)))"]
  U -->|"client signature<br/>at any time"| C["Client path"]
  U -->|"Swissquote + trusted contact signatures<br/>AND coin unmoved for D blocks"| R["Recovery path"]
  R --> N["Client's new account<br/>(new client key, same guardians)"]
  C -->|"send to self = refresh<br/>the delay D restarts from zero"| U
```

## Main flows

| Flow | Steps | Who signs | Depends on Swissquote? |
| --- | --- | --- | --- |
| Login | Simulated e-banking: bank-mock session, fictitious CHF accounts | — | Yes (simulated bank) |
| Wallet creation | The contact sends their public key → the Client Wallet generates the seed, shows it once, returns the public key → the app gets Swissquote's key, compiles the policy, registers the account → the wallet stores the policy | — | Yes (Swissquote key and registration) |
| Client spend | The app prepares and simulates the PSBT → the Client Wallet decodes it and asks for confirmation, then signs → the app finalizes and broadcasts | Client | **No** (attack 3; account cached locally) |
| Refresh | Send all coins to a fresh change address of the account | Client | No |
| Recovery | Re-KYC → old account found → new key → recovery PSBT → bank-mock signs → the contact signs in their console (link relayed by Swissquote) → the app combines, finalizes, broadcasts; real `non-BIP68-final` rejection before D | Swissquote + trusted contact | Yes (by design) |
| Account ↔ wallet transfer | Withdrawal: ownership proof signed by the Client Wallet → Swissquote's omnibus wallet sends on-chain → Travel Rule record. Deposit: credited only if all inputs come from a registered wallet of the client | Client (proof) / Swissquote (custody) | Yes (custody account) |

## Components

| Folder | Role | Real / mocked |
| --- | --- | --- |
| `packages/bitcoin` | Miniscript policy, descriptors, scan, PSBT, simulation, finalization, Esplora and bitcoind backends. `index.ts` exposes no key or signature; `sign.ts` and `keys.ts` are reserved for tools, bank-mock and the console | Real |
| `client/` | Bank app (port 5173): login, Overview, Accounts, crypto wallet, recovery, Demo | Wallet real; bank and session simulated |
| `client-wallet/` | Client Wallet (port 5180): a single process (API + Vite interface as middleware), storage in `client-wallet/data/` | Reference implementation |
| `bank-mock/` | Simulated bank and Swissquote guardian (port 4000): login, fictitious CHF accounts, public key, Bitcoin accounts, mocked re-KYC, signing limited to recoveries, custody account and Travel Rule records, relay to the trusted contact, log | Mocked |
| `guardian-console/` | Trusted-contact console (port 5174): identity creation, decoding, signing, relay | Real (logic) |
| `tools/client-signer`, `tools/keygen` | Signer and seed generator for the test scripts | Test tools |
| `scripts/attacks/` | Attack scenarios (tests and panel, port 4200) | Real against regtest, throw-away seeds |
| `docker/regtest.yml` | bitcoind 29 regtest | Real |

## Libraries (no home-made cryptography)

`@bitcoinerlab/miniscript-policies` 1.1.0 (sipa's reference compiler), `@bitcoinerlab/miniscript` 2.0.0, `@bitcoinerlab/descriptors-scure` 3.2.0 (`@scure/btc-signer`, `@scure/bip32`, `@noble/curves`), `@scure/bip39` 2.4.0, `@scure/base` 2.4.0, `bip322-js` 4.0.0, `@simplewebauthn/server` 14.0.3 and `/browser` 14.0.0, React 19.3, Vite 8.3, `node:sqlite` (Node 24), `playwright-core` 1.64 (tests only).
