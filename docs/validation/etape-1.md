# Étape 1 : compte Bitcoin, dépense du client par signataire externe (porte A)

Modèle : « Modèle 2 guardians » de SPEC.md. Politique `or(pk(C),and(pk(S),and(pk(T),older(D))))`, compilée en `andor(pk(@S),and_v(v:pk(@T),older(D)),pk(@C))`, en P2WSH, avec des descripteurs à plage. L'appli ne reçoit que des clés publiques.

## Livré

| Élément | Emplacement |
| --- | --- |
| Bibliothèque partagée : politique, descripteurs, scan, construction, décodage et finalisation de PSBT, backends Esplora et bitcoind | `packages/bitcoin/src/` (`index.ts` ne contient ni clé privée ni signature ; `sign.ts` et `keys.ts` sont réservés aux outils et à bank-mock) |
| Appli web : création du compte (3 clés publiques), réception, coins avec délai de recovery, envoi par PSBT, simulation, rafraîchissement | `client/src/` |
| Signataire externe de démo (remplace Sparrow, Liana ou un wallet matériel) : affiche, signe, ne stocke rien | `tools/client-signer/` |
| Création de graine de démo (remplace un wallet externe) | `tools/keygen/` |
| bitcoind 29 regtest | `docker/regtest.yml` |

## Bibliothèques (versions installées)

`@bitcoinerlab/descriptors-scure` 3.2.0, `@bitcoinerlab/miniscript-policies` 1.1.0 (compilateur de référence de sipa), `@bitcoinerlab/miniscript` 2.0.0, `@scure/bip39` 2.4.0, `@scure/base` 2.4.0, React 19.3, Vite 8.3, `playwright-core` 1.64 (tests uniquement, avec le Chrome installé). Aucune cryptographie écrite à la main.

## Commandes

```bash
npm install
npm run regtest:up
npm run validate:1                       # bibliothèque + tools/client-signer + Bitcoin Core (sortie : etape-1-regtest-sortie.txt)
VITE_BTC_NETWORK=regtest npm run dev     # dans un autre terminal
npm run validate:1:ui                    # parcours complet dans Chrome headless (sortie : etape-1-ui-sortie.txt, captures/)
npm run validate:1:signet -- address|status|spend
```

## Résultats

| # | Critère | Verdict |
| --- | --- | --- |
| 1 | Politique à un délai compilée, descripteur à plage | fonctionne |
| 2 | Réception sur deux adresses du compte, retrouvées par le scan | fonctionne |
| 3a | PSBT préparé et simulé en clair : chemin, sorties, change reconnu, frais | fonctionne |
| 3b | PSBT signé par `tools/client-signer` (processus séparé), finalisé et diffusé par l'appli, confirmé | fonctionne |
| 4 | **Signataire externe réel** : Bitcoin Core 29 (wallet de descripteurs, `walletprocesspsbt`) signe le PSBT Miniscript ; l'appli finalise et diffuse | fonctionne |
| 5 | Envoi total : plus aucun UTXO | fonctionne |
| UI-1 | Dans Chrome, compte créé à partir des 3 clés publiques, adresse affichée | fonctionne |
| UI-2 | Réception visible : solde, coin, « recovery dans 5 blocs » | fonctionne |
| UI-3 | PSBT préparé et simulé dans l'interface | fonctionne |
| UI-4 | PSBT signé à l'extérieur, collé, vérifié, diffusé depuis l'interface, confirmé | fonctionne |
| UI-5 | `localStorage` : uniquement la configuration publique | fonctionne |
| UI-6 | Aucune erreur dans la console du navigateur | fonctionne (après correction : scans `scantxoutset` sérialisés, favicon) |
| Inv. 5 | Bundle `client/dist` : 0 clé privée étendue, pas de liste BIP39 ; `client/src` n'importe ni `sign` ni `keys` | fonctionne (*) |
| Signet | Vraie dépense du client sur signet : PSBT préparé par la bibliothèque, signé par `tools/client-signer`, finalisé et diffusé, visible sur l'explorateur public | fonctionne |
| Sparrow | Signature du PSBT par Sparrow | **non testé**, et très probablement impossible (issues #1700 et #1757) |

(*) Le bundle contient le code des fonctions de signature de la bibliothèque (`signBIP32`, `signECPair`), non éliminé au build. L'appli ne les appelle jamais et n'a aucune clé à leur fournir.

Captures : `docs/validation/captures/etape-1-*.png`.

## Signet (porte A)

Clés de test : `.local/signet/` et `bank-mock/data/` (ignorés par git). Le faucet (signetfaucet.com) a envoyé 1 000 sats à l'adresse de réception 0 `tb1qarafnuq5c5vmq7f09p789mapzajfky0m7s96p7qsw99gqftxauts55cfrc` (tx `939a683b…88d0`, confirmée).

Commande : `npm run validate:1:signet -- spend` (sortie : `etape-1-signet-sortie.txt`). Le script envoie tout le coin vers l'adresse 1 du compte, à 1 sat/vB. C'est une dépense réelle par le chemin client, qui sert aussi de rafraîchissement.

- Transaction : [9203045ed6d150a225821dff8c4287601f94d0c065ec975a795e92f637e6d248](https://blockstream.info/signet/tx/9203045ed6d150a225821dff8c4287601f94d0c065ec975a795e92f637e6d248)
- Entrée : 1 000 sats depuis l'adresse P2WSH de la politique, nSequence 0xfffffffd (chemin client, sans délai), 1 signature (client).
- Sortie : 859 sats vers `tb1qzqsel62x8wyct2yuagpcd88x4yehce03qzrksm3hlgd80kj55wvq27ldtm` (adresse 1 du compte). Frais : 141 sats.
- Observé avec l'API de l'explorateur juste après la diffusion : transaction présente (en mempool, 0 confirmation au moment de l'observation).
