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

## Suite : refonte de l'onglet Crypto et du Wallet du client

- **Onglet Crypto** : fiche d'actif sur le modèle de la plateforme Swissquote. À gauche, en-tête Bitcoin (solde, contre-valeur, pastille de statut de la recovery), actions rondes (Recevoir, Envoyer, Rafraîchir) et sous-onglets Historique / Coins / Sécurité. À droite, panneau d'action à la manière de « New order » : Recevoir par défaut, avec **QR code** (bibliothèque `qrcode` 1.5.4), copie, nouvelle adresse et preuve de propriété ; ou Envoyer / Rafraîchir. Sur téléphone, tout est empilé. Historique en liste avec icônes (reçu, envoyé, interne).
- **Wallet du client** : même langage visuel que l'appli (fond clair, cartes, typographie, boutons), identité propre (icône clé, « Indépendant de Swissquote », mention d'implémentation de référence). Écran de confirmation avec le montant envoyé en grand, le destinataire et les frais, puis le détail.
- Parcours complet revalidé : 15/15 sur ordinateur, 16/16 sur téléphone.

## Limite de débit de l'API Esplora publique (signet)

blockstream.info limite l'API gratuite à **700 requêtes par heure et par IP**. La limite a été atteinte (`429 Too Many Requests`), surtout par la surveillance signet de bank-mock (40 adresses × 3 comptes toutes les 5 min). Corrections :

| Correction | Effet |
| --- | --- |
| Découverte des adresses par **limite d'écart** (arrêt après 5 adresses consécutives jamais utilisées, par chaîne) quand le backend sait si une adresse a servi | moins d'adresses interrogées |
| **Cache** de 20 s des lectures par adresse (scan et historique partagent les requêtes) ; UTXO demandés seulement pour les adresses utilisées | pas de requête en double |
| Surveillance signet de bank-mock toutes les **15 min** (au lieu de 5) | ÷ 3 |

Mesure hors ligne (`npm run validate:9:budget`, fausse API qui compte les appels) : **15 requêtes** par rafraîchissement (scan + historique) au lieu d'environ 80 (`etape-9-budget-sortie.txt`).

Pendant la fenêtre de blocage, les contrôles signet 9-5 et 9-6 ont échoué sur `429` : **non testés** après la correction, à relancer une fois la limite levée. Les contrôles regtest 9-1 à 9-4 passent. Pour une démo signet intensive : une instance Esplora propre ou une clé d'API blockstream (`VITE_ESPLORA_URL`, `ESPLORA_URL`).
