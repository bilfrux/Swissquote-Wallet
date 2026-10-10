# Step 0 Bitcoin: feasibility of the recovery policy (10 October 2026)

## Corrected assumption

The requested policy reuses BACKUP, SQ and TRUSTED in two paths. **It does not compile**: Miniscript forbids the same key appearing twice in a script (`[compile error]`, `issane = false`). Chosen fix: P2WSH, with **one derived key per actor and per path**, from a single seed per actor. The semantics are unchanged. Taproot, where the same key can serve in several leaves, was the other option; it was not retained here.

Derivation (demo choice, BIP48 P2WSH testnet): `m/48'/1'/0'/2'` then
- client: `/0/<generation>` (new generation after a recovery);
- backup: `/1/0` (path 1) and `/2/0` (path 2);
- Swissquote: `/1/0` (path 1) and `/3/0` (path 3);
- trusted contact: `/2/0` (path 2) and `/3/0` (path 3).

Compiled Miniscript, with D1 = 6, D2 = 12, D3 = 24:

```
or_d(pk(@C),or_i(and_v(and_v(v:pkh(@B1),v:pkh(@S1)),older(6)),or_i(and_v(and_v(v:pkh(@B2),v:pkh(@T2)),older(12)),and_v(and_v(v:pkh(@S3),v:pkh(@T3)),older(24)))))
```

## Libraries (versions checked on npm, all established, no home-made cryptography)

| Role | Package | Version |
| --- | --- | --- |
| Seeds | @scure/bip39 | 2.4.0 |
| Derivation | @scure/bip32 (HDKey, via descriptors-scure) | 2.4.0 |
| Policy compilation | @bitcoinerlab/miniscript-policies (sipa's reference compiler, via Emscripten) | 1.1.0 |
| Analysis and satisfactions | @bitcoinerlab/miniscript | 2.0.0 |
| Addresses, PSBT, signing, finalization | @bitcoinerlab/descriptors-scure (on @scure/btc-signer) | 3.2.0 |
| Node | bitcoind 29 (Docker image `bitcoin/bitcoin:29`), regtest | 29 |

Note: the scure adapter warns that it does not fully verify signatures before finalization. Full validity is checked by bitcoind (`testmempoolaccept`, `sendrawtransaction`).

## Commands

```bash
cd scripts/feasibility-btc
npm install
npm run regtest:up     # bitcoind regtest in Docker
npm run regtest        # full output: docs/validation/etape-0-bitcoin-sortie.txt
```

## Regtest results

| # | Point | Verdict |
| --- | --- | --- |
| 0a | Policy compiled, `issane = true` | works |
| 0b | Static analysis of satisfactions: client alone; SQ + backup with nSequence 6; backup + trusted contact with 12; SQ + trusted contact with 24. No satisfaction by SQ alone | works |
| 1 | Address derived on regtest (`bcrt1q…`) and signet (`tb1q…`) | works |
| 2a | Receive on the policy address | works |
| 2b | Spend by the client alone, 1 confirmation after receiving | works |
| 3a | backup + Swissquote: `non-BIP68-final` at 5 confirmations, accepted and broadcast at 6 | works |
| 3b | backup + trusted contact (Swissquote absent): refused at 11, accepted at 12 | works |
| 3c | Swissquote + trusted contact: refused at 23, accepted at 24 | works |
| 4 | Swissquote alone, even after D3 + 5 blocks: the library finds no path (`unresolvable miniscript`), including on the SQ + trusted-contact path without the contact's signature | works (*) |
| 5 | Refresh: the delay D1 restarts from the confirmation of the new UTXO | works |
| 6 | PSBT decoded by bitcoind (output, amount, fee, nSequence of the path) | works |

(*) The refusal is observed at library level, and proved by the static analysis 0b. A hand-forged transaction with Swissquote's signature alone was not submitted to the node: that would mean hand-writing a witness.

The PSBTs are signed **separately** by each actor: each receives its own serialized BIP174 copy. They are then combined (`Transaction.combine`), finalized, then broadcast.

## Signet

| Point | Verdict |
| --- | --- |
| Signet address derived: `tb1qj83sanchfnqx6wjszuhu5d5p0mt205777y3h2w4rerxzfnfk7c4sd8dpzj` | works |
| Signet API reachable: blockstream.info (mempool.space unreachable from this machine) | works |
| Receive, real client spend, real recovery (D1 = 6 blocks, about 1 h) | **not tested**: waiting for faucet funding |

Test signet seeds: `scripts/feasibility-btc/.keys/signet.json`, ignored by git (checked with `git check-ignore`).

## Open points

- **Refresh frequency = D1.** The client must move each UTXO before D1. With a 3-day target, that is about 120 transactions a year. This is the trade-off to argue.
- **Reuse of guardian keys**: the guardians' keys are the same for all address generations. This is a privacy limit of the demo.
