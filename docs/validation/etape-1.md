# Step 1: Bitcoin account, client spend through an external signer (gate A)

Model: "2-guardian model" of SPEC.md. Policy `or(pk(C),and(pk(S),and(pk(T),older(D))))`, compiled to `andor(pk(@S),and_v(v:pk(@T),older(D)),pk(@C))`, as P2WSH, with ranged descriptors. The app only receives public keys.

## Delivered

| Item | Location |
| --- | --- |
| Shared library: policy, descriptors, scan, PSBT construction, decoding and finalization, Esplora and bitcoind backends | `packages/bitcoin/src/` (`index.ts` contains no private key or signature; `sign.ts` and `keys.ts` are reserved for tools and bank-mock) |
| Web app: account creation (3 public keys), receive, coins with recovery delay, PSBT send, simulation, refresh | `client/src/` |
| Demo external signer (replaces Sparrow, Liana or a hardware wallet): displays, signs, stores nothing | `tools/client-signer/` |
| Demo seed creation (replaces an external wallet) | `tools/keygen/` |
| bitcoind 29 regtest | `docker/regtest.yml` |

## Libraries (installed versions)

`@bitcoinerlab/descriptors-scure` 3.2.0, `@bitcoinerlab/miniscript-policies` 1.1.0 (sipa's reference compiler), `@bitcoinerlab/miniscript` 2.0.0, `@scure/bip39` 2.4.0, `@scure/base` 2.4.0, React 19.3, Vite 8.3, `playwright-core` 1.64 (tests only, with the installed Chrome). No hand-written cryptography.

## Commands

```bash
npm install
npm run regtest:up
npm run validate:1                       # library + tools/client-signer + Bitcoin Core (output: etape-1-regtest-sortie.txt)
VITE_BTC_NETWORK=regtest npm run dev     # in another terminal
npm run validate:1:ui                    # full journey in headless Chrome (output: etape-1-ui-sortie.txt, captures/)
npm run validate:1:signet -- address|status|spend
```

## Results

| # | Criterion | Verdict |
| --- | --- | --- |
| 1 | Single-delay policy compiled, ranged descriptor | works |
| 2 | Receive on two addresses of the account, found by the scan | works |
| 3a | PSBT prepared and simulated in plain language: path, outputs, recognised change, fee | works |
| 3b | PSBT signed by `tools/client-signer` (separate process), finalized and broadcast by the app, confirmed | works |
| 4 | **Real external signer**: Bitcoin Core 29 (descriptor wallet, `walletprocesspsbt`) signs the Miniscript PSBT; the app finalizes and broadcasts | works |
| 5 | Full send: no UTXO left | works |
| UI-1 | In Chrome, account created from the 3 public keys, address displayed | works |
| UI-2 | Receive visible: balance, coin, "recovery in 5 blocks" | works |
| UI-3 | PSBT prepared and simulated in the interface | works |
| UI-4 | PSBT signed externally, pasted, checked, broadcast from the interface, confirmed | works |
| UI-5 | `localStorage`: public configuration only | works |
| UI-6 | No error in the browser console | works (after fix: serialized `scantxoutset` scans, favicon) |
| Inv. 5 | `client/dist` bundle: 0 extended private keys, no BIP39 list; `client/src` imports neither `sign` nor `keys` | works (*) |
| Signet | Real client spend on signet: PSBT prepared by the library, signed by `tools/client-signer`, finalized and broadcast, visible on the public explorer | works |
| Sparrow | PSBT signing by Sparrow | **not tested**, and most likely impossible (issues #1700 and #1757) |

(*) The bundle contains the code of the library's signing functions (`signBIP32`, `signECPair`), not removed at build time. The app never calls them and has no key to give them.

Screenshots: `docs/validation/captures/etape-1-*.png`.

## Signet (gate A)

Test keys: `.local/signet/` and `bank-mock/data/` (ignored by git). The faucet (signetfaucet.com) sent 1,000 sats to receive address 0 `tb1qarafnuq5c5vmq7f09p789mapzajfky0m7s96p7qsw99gqftxauts55cfrc` (tx `939a683b…88d0`, confirmed).

Command: `npm run validate:1:signet -- spend` (output: `etape-1-signet-sortie.txt`). The script sends the whole coin to address 1 of the account, at 1 sat/vB. It is a real spend through the client path, which also serves as a refresh.

- Transaction: [9203045ed6d150a225821dff8c4287601f94d0c065ec975a795e92f637e6d248](https://blockstream.info/signet/tx/9203045ed6d150a225821dff8c4287601f94d0c065ec975a795e92f637e6d248)
- Input: 1,000 sats from the policy's P2WSH address, nSequence 0xfffffffd (client path, no delay), 1 signature (client).
- Output: 859 sats to `tb1qzqsel62x8wyct2yuagpcd88x4yehce03qzrksm3hlgd80kj55wvq27ldtm` (address 1 of the account). Fee: 141 sats.
- Observed with the explorer API right after broadcast: transaction present (in mempool, 0 confirmations at the time of observation).
