# Step 4: attacks, invariants and proofs

All attacks are run against a real node (bitcoind 29, regtest). Each scenario creates a **demo** account with throw-away seeds. The colluding "Swissquote" and "trusted contact" roles use their own demo keys and **bypass bank-mock**, as a malicious guardian would: only consensus is tested.

## Delivered

| Item | Location |
| --- | --- |
| Scenarios (3 attacks and invariant 1), shared by the tests and the panel | `scripts/attacks/attacks.ts` |
| `npm run test:attacks`: runs everything, writes `docs/validation/etape-4-attaques.json` | `scripts/attacks/run.ts` |
| Panel server (regtest demo, port 4200, separate process; only returns verdicts and messages) | `scripts/attacks/server.ts` |
| "Attacks" panel (shown on regtest) | `client/src/attacks/AttackPanel.tsx` |
| Invariant 5, with positive control | `scripts/validate/invariant-5.ts` |

For invariant 1 and attack 1, the library refuses to finalize. The P2WSH witness is therefore placed by hand (signatures produced by `@scure/btc-signer`, `@bitcoinerlab/descriptors` or `@noble/curves`, and the account's `witnessScript`) to obtain the **consensus verdict**.

## Commands

```bash
npm run regtest:up
npm run test:attacks          # output: etape-4-attaques-sortie.txt, JSON proofs: etape-4-attaques.json
npm run validate:inv5         # output: etape-4-invariant-5-sortie.txt
npm run attacks:server        # then the app on regtest
npm run validate:4:ui         # output: etape-4-ui-sortie.txt, screenshot: captures/etape-4-panneau-attaques.png
```

## Results

| # | Scenario | Expected | Actual chain message | Verdict |
| --- | --- | --- | --- | --- |
| Inv. 1 | Swissquote alone, **after D**, recovery path (witness `[∅, Swissquote sig]`) | rejection | `mempool-script-verify-flag-failed (Script failed an OP_CHECKSIGVERIFY operation)` | works |
| Inv. 1 | Swissquote alone, client path (Swissquote signature in place of the client's) | rejection | `mempool-script-verify-flag-failed (Signature must be zero for failed CHECK(MULTI)SIG operation)` | works |
| Inv. 1 | Library: finalization with the Swissquote signature alone | rejection | `unresolvable miniscript andor(pk(@0),and_v(v:pk(@1),older(6)),pk(@2))` | works |
| Att. 1 | Phone + email stolen, no keys: Swissquote re-KYC refused (403); after D, two attacker signatures in place of the guardians | rejection | `mempool-script-verify-flag-failed (Signature must be zero for failed CHECK(MULTI)SIG operation)` | works |
| Att. 2 | Swissquote + contact collusion, at 1 and 5 confirmations (D = 6) | rejection | `non-BIP68-final` | works |
| Att. 2 (info) | Same transaction at D, without refresh (not broadcast) | accepted grey zone | `accepted` | observed |
| Att. 3 | bank-mock stopped (`ECONNREFUSED`); the client signs with `tools/client-signer` and broadcasts | success | `broadcast <txid>` | works |
| Inv. 5 | Control: the search finds the 14 seeds where they are stored | 14/14 | — | works |
| Inv. 5 | None of the machine's 14 seeds, nor its account private key, in `client/src`, `client/dist`, `client/index.html`, `client/vite.config.ts` | nothing | — | works |
| Inv. 5 | No xprv/tprv, no WIF key in the sources, no BIP39 list in the bundle | nothing | — | works |
| Inv. 5 | `client/src` imports no signing, seed or private-key derivation | nothing | — | works |
| UI-1…3 | The three panel buttons: verdict, "as expected", actual message displayed | — | (same as the lines above) | works |
| UI-4 | No error in the browser console | — | — | works |

Information, non-blocking: the bundle contains the **code** of the library's `signBIP32` and `signECPair` functions (not removed at build time). The app never calls it and has no key to give it.

Search commands of invariant 5 (secrets go through a temporary file outside the repository):

```bash
grep -rlF -f <seeds + tprv from .local/ and bank-mock/data/> client/src client/dist client/index.html client/vite.config.ts   # -> nothing
grep -rlF -f <same> .local bank-mock/data                                                                                    # control -> 14 files
grep -rlE '[tx]prv[1-9A-HJ-NP-Za-km-z]{100,}' client/src client/dist client/index.html client/vite.config.ts                 # -> nothing
grep -rlE '\b[c9KL5][1-9A-HJ-NP-Za-km-z]{50,51}\b' client/src                                                               # -> nothing
grep -rl '"abandon","ability"' client/dist                                                                                   # -> nothing
grep -rnE '@sq/bitcoin/(sign|keys)|mnemonicToSeed|fromMasterSeed|privateExtendedKey|signBIP32|signers\.' client/src          # -> nothing
```

## Who signs the client's spends, and where are the keys?

**The app never signs and never receives a private key.** It only prepares unsigned PSBTs, then finalizes and broadcasts what it is given back.

What signs the client's spends today:
1. **`tools/client-signer`**: the demo signer replacing the external wallet. Separate process; it reads the phrase at run time (typed or `--mnemonic-file`), displays what it signs, signs and only writes the signed PSBT. The tests, the step 1 signet run and attack 3 use it.
2. **Bitcoin Core 29** (`walletprocesspsbt`): a real external signer, validated at step 1 on regtest. It holds a **test** client key in its `client-core` wallet, inside the Docker container.

**Test** client keys stored on the machine, all in mode 600 and ignored by git (none is tracked: the only tracked file containing the word `mnemonic` is a test that checks for its absence):
- `.local/signet/client.json` and `.local/signet/client-new.json`: signet accounts (steps 1 and 3);
- `.local/regtest/client.json`, `.local/regtest-ui/client.json`, `.local/bm-test/client.json`: written by the validation scripts;
- `scripts/validate/lib.ts` (`clientSign`) writes a temporary file and **deletes** it after signing.

These files stand for the client's external wallet for the demo. In the real model, they do not exist: the phrase stays in the client's wallet.
Other seeds present: Swissquote in `bank-mock/data/` (and `.local/bm-*` for test instances), trusted contact in `.local/signet/tiers.json` and `.local/regtest-ui/tiers.json`.
