# Étape 4 : attaques, invariants et preuves

Toutes les attaques sont exécutées contre un vrai nœud (bitcoind 29, regtest). Chaque scénario crée un compte de **démo** avec des graines jetables. Les rôles « Swissquote » et « tiers » complices utilisent leurs propres clés de démo et **contournent bank-mock**, comme le ferait un guardian malveillant : seul le consensus est testé.

## Livré

| Élément | Emplacement |
| --- | --- |
| Scénarios (3 attaques et invariant 1), partagés par les tests et le panneau | `scripts/attacks/attacks.ts` |
| `npm run test:attacks` : exécute tout, écrit `docs/validation/etape-4-attaques.json` | `scripts/attacks/run.ts` |
| Serveur du panneau (démo regtest, port 4200, processus séparé ; ne renvoie que verdicts et messages) | `scripts/attacks/server.ts` |
| Panneau « Attaques » (affiché en regtest) | `client/src/attacks/AttackPanel.tsx` |
| Invariant 5, avec témoin positif | `scripts/validate/invariant-5.ts` |

Pour les invariants 1 et l'attaque 1, la bibliothèque refuse de finaliser. On pose donc le témoin P2WSH à la main (signatures produites par `@scure/btc-signer`, `@bitcoinerlab/descriptors` ou `@noble/curves`, et le `witnessScript` du compte) pour obtenir le **verdict du consensus**.

## Commandes

```bash
npm run regtest:up
npm run test:attacks          # sortie : etape-4-attaques-sortie.txt, preuves JSON : etape-4-attaques.json
npm run validate:inv5         # sortie : etape-4-invariant-5-sortie.txt
npm run attacks:server        # puis l'appli en regtest
npm run validate:4:ui         # sortie : etape-4-ui-sortie.txt, capture : captures/etape-4-panneau-attaques.png
```

## Résultats

| # | Scénario | Attendu | Message réel de la chaîne | Verdict |
| --- | --- | --- | --- | --- |
| Inv. 1 | Swissquote seule, **après D**, chemin recovery (témoin `[∅, sig Swissquote]`) | refus | `mempool-script-verify-flag-failed (Script failed an OP_CHECKSIGVERIFY operation)` | fonctionne |
| Inv. 1 | Swissquote seule, chemin client (signature Swissquote à la place du client) | refus | `mempool-script-verify-flag-failed (Signature must be zero for failed CHECK(MULTI)SIG operation)` | fonctionne |
| Inv. 1 | Bibliothèque : finalisation avec la seule signature Swissquote | refus | `unresolvable miniscript andor(pk(@0),and_v(v:pk(@1),older(6)),pk(@2))` | fonctionne |
| Att. 1 | Téléphone + email volés, sans clés : re-KYC Swissquote refusé (403) ; après D, deux signatures de l'attaquant à la place des guardians | refus | `mempool-script-verify-flag-failed (Signature must be zero for failed CHECK(MULTI)SIG operation)` | fonctionne |
| Att. 2 | Collusion Swissquote + tiers, à 1 et à 5 confirmations (D = 6) | refus | `non-BIP68-final` | fonctionne |
| Att. 2 (info) | Même transaction à D, sans rafraîchissement (non diffusée) | zone grise assumée | `accepté` | observé |
| Att. 3 | bank-mock arrêté (`ECONNREFUSED`) ; le client signe avec `tools/client-signer` et diffuse | succès | `diffusée <txid>` | fonctionne |
| Inv. 5 | Témoin : la recherche retrouve les 14 graines là où elles sont stockées | 14/14 | — | fonctionne |
| Inv. 5 | Aucune des 14 graines de la machine, ni sa clé privée de compte, dans `client/src`, `client/dist`, `client/index.html`, `client/vite.config.ts` | rien | — | fonctionne |
| Inv. 5 | Aucun xprv/tprv, aucune clé WIF dans les sources, pas de liste BIP39 dans le bundle | rien | — | fonctionne |
| Inv. 5 | `client/src` n'importe ni signature, ni graine, ni dérivation de clé privée | rien | — | fonctionne |
| UI-1…3 | Les trois boutons du panneau : verdict, « conforme », message réel affiché | — | (identiques aux lignes ci-dessus) | fonctionne |
| UI-4 | Aucune erreur dans la console du navigateur | — | — | fonctionne |

Information, non bloquante : le bundle contient le **code** des fonctions `signBIP32` et `signECPair` de la bibliothèque (non éliminé au build). L'appli ne l'appelle jamais et n'a aucune clé à lui fournir.

Commandes de recherche de l'invariant 5 (les secrets passent par un fichier temporaire hors du dépôt) :

```bash
grep -rlF -f <graines + tprv de .local/ et bank-mock/data/> client/src client/dist client/index.html client/vite.config.ts   # -> rien
grep -rlF -f <idem> .local bank-mock/data                                                                                # témoin -> 14 fichiers
grep -rlE '[tx]prv[1-9A-HJ-NP-Za-km-z]{100,}' client/src client/dist client/index.html client/vite.config.ts             # -> rien
grep -rlE '\b[c9KL5][1-9A-HJ-NP-Za-km-z]{50,51}\b' client/src                                                           # -> rien
grep -rl '"abandon","ability"' client/dist                                                                               # -> rien
grep -rnE '@sq/bitcoin/(sign|keys)|mnemonicToSeed|fromMasterSeed|privateExtendedKey|signBIP32|signers\.' client/src      # -> rien
```

## Qui signe les dépenses du client, et où sont les clés ?

**L'appli ne signe jamais et ne reçoit jamais de clé privée.** Elle ne prépare que des PSBT non signés, puis finalise et diffuse ce qu'on lui rend.

Ce qui signe les dépenses du client aujourd'hui :
1. **`tools/client-signer`** : le signataire de démo qui remplace le wallet externe. Processus séparé ; il lit la phrase à l'exécution (saisie ou `--mnemonic-file`), affiche ce qu'il signe, signe et n'écrit que le PSBT signé. C'est lui qu'utilisent les tests, le signet de l'étape 1 et l'attaque 3.
2. **Bitcoin Core 29** (`walletprocesspsbt`) : un vrai signataire externe, validé à l'étape 1 en regtest. Il détient une clé client de **test** dans son wallet `client-core`, à l'intérieur du conteneur Docker.

Clés de **test** du client stockées sur la machine, toutes en mode 600 et ignorées par git (aucune n'est suivie : le seul fichier suivi qui contient le mot `mnemonic` est un test qui vérifie son absence) :
- `.local/signet/client.json` et `.local/signet/client-new.json` : comptes signet (étapes 1 et 3) ;
- `.local/regtest/client.json`, `.local/regtest-ui/client.json`, `.local/bm-test/client.json` : écrits par les scripts de validation ;
- `scripts/validate/lib.ts` (`clientSign`) écrit un fichier temporaire et le **supprime** après signature.

Ces fichiers représentent le wallet externe du client pour la démo. Dans le modèle réel, ils n'existent pas : la phrase reste dans le wallet du client.
Autres graines présentes : Swissquote dans `bank-mock/data/` (et `.local/bm-*` pour les instances de test), tiers dans `.local/signet/tiers.json` et `.local/regtest-ui/tiers.json`.
