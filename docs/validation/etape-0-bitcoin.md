# Étape 0 Bitcoin : faisabilité de la politique de recovery (10 octobre 2026)

## Hypothèse corrigée

La politique demandée réutilise BACKUP, SQ et TIERS dans deux chemins. **Elle ne compile pas** : Miniscript interdit qu'une même clé apparaisse deux fois dans un script (`[compile error]`, `issane = false`). Correction retenue : P2WSH, avec **une clé dérivée par acteur et par chemin**, à partir d'une seule graine par acteur. La sémantique est inchangée. Taproot, où la même clé peut servir dans plusieurs feuilles, était l'autre option ; elle n'a pas été retenue ici.

Dérivation (choix de démo, BIP48 P2WSH testnet) : `m/48'/1'/0'/2'` puis
- client : `/0/<génération>` (nouvelle génération après une recovery) ;
- backup : `/1/0` (chemin 1) et `/2/0` (chemin 2) ;
- Swissquote : `/1/0` (chemin 1) et `/3/0` (chemin 3) ;
- tiers : `/2/0` (chemin 2) et `/3/0` (chemin 3).

Miniscript compilé, avec D1 = 6, D2 = 12, D3 = 24 :

```
or_d(pk(@C),or_i(and_v(and_v(v:pkh(@B1),v:pkh(@S1)),older(6)),or_i(and_v(and_v(v:pkh(@B2),v:pkh(@T2)),older(12)),and_v(and_v(v:pkh(@S3),v:pkh(@T3)),older(24)))))
```

## Bibliothèques (versions vérifiées sur npm, toutes établies, aucune cryptographie maison)

| Rôle | Paquet | Version |
| --- | --- | --- |
| Graines | @scure/bip39 | 2.4.0 |
| Dérivation | @scure/bip32 (HDKey, via descriptors-scure) | 2.4.0 |
| Compilation de la politique | @bitcoinerlab/miniscript-policies (compilateur de référence de sipa, via Emscripten) | 1.1.0 |
| Analyse et satisfactions | @bitcoinerlab/miniscript | 2.0.0 |
| Adresses, PSBT, signature, finalisation | @bitcoinerlab/descriptors-scure (sur @scure/btc-signer) | 3.2.0 |
| Nœud | bitcoind 29 (image Docker `bitcoin/bitcoin:29`), regtest | 29 |

Remarque : l'adaptateur scure avertit qu'il ne vérifie pas complètement les signatures avant finalisation. La validité complète est vérifiée par bitcoind (`testmempoolaccept`, `sendrawtransaction`).

## Commandes

```bash
cd scripts/feasibility-btc
npm install
npm run regtest:up     # bitcoind regtest dans Docker
npm run regtest        # sortie complète : docs/validation/etape-0-bitcoin-sortie.txt
```

## Résultats regtest

| # | Point | Verdict |
| --- | --- | --- |
| 0a | Politique compilée, `issane = true` | fonctionne |
| 0b | Analyse statique des satisfactions : client seul ; SQ + backup avec nSequence 6 ; backup + tiers avec 12 ; SQ + tiers avec 24. Aucune satisfaction par SQ seule | fonctionne |
| 1 | Adresse dérivée en regtest (`bcrt1q…`) et en signet (`tb1q…`) | fonctionne |
| 2a | Réception sur l'adresse de la politique | fonctionne |
| 2b | Dépense par le client seul, 1 confirmation après réception | fonctionne |
| 3a | backup + Swissquote : `non-BIP68-final` à 5 confirmations, accepté et diffusé à 6 | fonctionne |
| 3b | backup + tiers (Swissquote absente) : refusé à 11, accepté à 12 | fonctionne |
| 3c | Swissquote + tiers : refusé à 23, accepté à 24 | fonctionne |
| 4 | Swissquote seule, même après D3 + 5 blocs : la bibliothèque ne trouve aucun chemin (`unresolvable miniscript`), y compris sur le chemin SQ + tiers sans la signature du tiers | fonctionne (*) |
| 5 | Rafraîchissement : le délai D1 repart de la confirmation du nouvel UTXO | fonctionne |
| 6 | PSBT décodé par bitcoind (sortie, montant, frais, nSequence du chemin) | fonctionne |

(*) Le refus est observé au niveau de la bibliothèque, et prouvé par l'analyse statique 0b. Une transaction forgée à la main avec la seule signature de Swissquote n'a pas été soumise au nœud : ce serait écrire un témoin à la main.

Les PSBT sont signés **séparément** par chaque acteur : chacun reçoit sa propre copie BIP174 sérialisée. Ils sont ensuite combinés (`Transaction.combine`), finalisés, puis diffusés.

## Signet

| Point | Verdict |
| --- | --- |
| Adresse signet dérivée : `tb1qj83sanchfnqx6wjszuhu5d5p0mt205777y3h2w4rerxzfnfk7c4sd8dpzj` | fonctionne |
| API signet joignable : blockstream.info (mempool.space injoignable depuis ce poste) | fonctionne |
| Réception, dépense réelle du client, recovery réelle (D1 = 6 blocs, environ 1 h) | **non testé** : en attente de financement par faucet |

Graines signet de test : `scripts/feasibility-btc/.keys/signet.json`, ignoré par git (vérifié avec `git check-ignore`).

## Points ouverts

- **Fréquence de rafraîchissement = D1.** Le client doit déplacer chaque UTXO avant D1. Avec une cible de 3 jours, cela fait environ 120 transactions par an. C'est le compromis à argumenter.
- **Réutilisation des clés de guardians** : les clés des guardians sont les mêmes pour toutes les générations d'adresses. C'est une limite de confidentialité de la démo.
