# Étape 9 : historique des transactions et estimation des frais

## Livré

| Élément | Emplacement |
| --- | --- |
| `ChainBackend.history()` et `feeRates()` : Esplora (signet) via `/address/:a/txs` et `/fee-estimates` ; bitcoind (regtest) via un wallet **en lecture seule** créé une fois par compte avec ses descripteurs **publics** (aucune clé privée), `listsinceblock` (avec `include_change`, sinon les rafraîchissements sont masqués) et `getrawtransaction` (les sorties dépensées sont relues pour les transactions en mempool), `estimatesmartfee` | `packages/bitcoin/src/backend.ts` |
| `history(cfg, backend)` : chaque transaction classée du point de vue du compte (« reçu », « reçu par recovery », « envoyé », « rafraîchissement », « recovery sortante » si nSequence = D), montant net et frais | `packages/bitcoin/src/wallet.ts` |
| Frais : taux en sat/vB, fractionnaires acceptés (frais arrondis au satoshi supérieur), jamais sous 1 sat/vB (minimum de relais ; l'API signet annonce parfois 0,1) | `backend.ts`, `wallet.ts` |
| Carte « Historique » (tableau sur ordinateur, liste sur téléphone, lien explorateur sur signet) ; préréglages de frais Économique / Normal / Rapide avec la source de l'estimation, « Normal » par défaut, champ libre conservé | `client/src/wallet/Account.tsx`, `Send.tsx` |

## Résultats

| # | Critère | Verdict |
| --- | --- | --- |
| 9-1 | regtest : deux réceptions (+0,3 et +0,2), un envoi (−0,1, frais exacts), un rafraîchissement (0, frais), une recovery sortante en attente (en tête de liste) | fonctionne |
| 9-2 | Côté nouveau compte, la même recovery apparaît « reçu par recovery » | fonctionne |
| 9-3 | Taux fractionnaire (3,5 sat/vB) : frais entiers | fonctionne |
| 9-4 | Frais regtest : estimation du nœud (ou valeurs par défaut), toutes ≥ 1 sat/vB | fonctionne |
| 9-5 | Frais **signet réels** (API Esplora), planchérisés à 1 sat/vB | fonctionne |
| 9-6 | Historique **signet réel** du wallet CH-0003 : réception de 10 000 sats du faucet | fonctionne |
| 6-16 | Interface (ordinateur et téléphone) : préréglages de frais affichés ; historique « Reçu +0,5 BTC » et « Envoyé −0,1 BTC » | fonctionne |
| Parcours complet | `validate:6:ui` : 15/15 sur ordinateur, 16/16 sur téléphone | fonctionne |
| Non-régression | `validate:1` à `validate:8:alerts`, `test:attacks`, `validate:inv5` ; typage des 7 projets | fonctionne (`etape-9-regressions-sortie.txt`) |

Défauts trouvés et corrigés en cours de route : `listtransactions` masquait les rafraîchissements ; en mempool, bitcoind ne donne pas les sorties dépensées ; la vérification d'existence du wallet lecture seule provoquait des erreurs 500 (remplacée par `listwalletdir`, et l'initialisation est sérialisée).

Limites : historique limité aux 20 premières adresses de chaque chaîne (comme le scan) et, sur Esplora, aux 25 dernières transactions par adresse. Pas d'accélération d'une transaction bloquée (RBF).
