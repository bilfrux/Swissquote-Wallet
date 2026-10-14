# Étape 52 — bank-mock : requêtes, retraits, frais de recovery, re-KYC

## Problèmes (audit), vérifiés sur le code d'origine

Le test de cette étape, lancé sur `worktree-docs-soumission` sans correction (`etape-52-avant-correction-sortie.txt`) :
- requête `text/plain` acceptée (200), formulaire et JSON invalide → 500, corps de 2 Mo lu en entier ;
- **deux retraits simultanés de 0,5 BTC pour 0,8 BTC d'avoirs : les deux passent**, solde final **−0,2 BTC**, 1 BTC
  reçu dans le wallet (le solde est vérifié, puis plusieurs `await`, puis débité) ;
- recovery dont les frais font 31,8 % du montant : signée par Swissquote ;
- re-KYC : après 5 codes SMS faux, le bon code est accepté (aucune limite, code à 6 chiffres).

## Modifications

- `bank-mock/src/server.ts` : POST en `application/json` seulement (415 sinon : une requête « simple » d'un autre site
  n'atteint plus les routes sans session) ; JSON invalide → 400 ; corps limité à 1 Mo (413, connexion fermée) ; frais d'une
  recovery plafonnés à 5 % du montant (`BANK_MOCK_MAX_RECOVERY_FEE_PCT`) ; `/evm/accounts/sync` : adresse invalide → 400.
- `bank-mock/src/custody.ts` : les retraits passent un par un (file d'attente).
- `bank-mock/src/kyc.ts` : 5 échecs de re-KYC → dossier bloqué 15 min (429), par client (`BANK_MOCK_KYC_MAX_FAILS`).
- `bank-mock/src/passkeys.ts` : mêmes origines par défaut que le CORS (5175 ajouté).
- `client-wallet/src/server.ts` : JSON avec `charset` accepté, JSON invalide → 400, corps limité à 1 Mo.
  `client/vite.config.ts` : connexion fermée sur 413.
- Tests : `etape-2.ts` (port configurable `VALIDATE_2_PORT`, arrêt si le port est déjà occupé : un autre bank-mock tournait
  sur 4100 et répondait à sa place) ; `etape-7.ts` et `etape-10-auth.ts` passés à la biométrie (ils créaient encore un
  wallet avec un PIN, refusé depuis l'étape 36).

Non modifié : avec `BANK_MOCK_CRYPTO_LOCK=off` (mode réservé aux anciens tests), `/accounts/register` accepte encore un
`customerId` sans session. Avec le verrou actif (configuration normale), une session déverrouillée est exigée (étape 38),
et l'en-tête `Authorization` rend le CSRF impossible.

## Validation exécutée

| Commande | Résultat observé |
| --- | --- |
| `npm run validate:52` | 4/4 (`etape-52-sortie.txt`) ; 0/4 sur le code d'origine |
| `VALIDATE_2_PORT=4101 npm run validate:2` | 8/8 |
| `npm run validate:7` ; `validate:10` | 8/8 ; 3/3 |
| `validate:8:alerts`, `validate:11`, `validate:12`, `test:attacks` | 6/6, 6/6, 2/2, 4/4 |
| `validate:37`, `validate:47`, `validate:50` | 8/8, 4/4, 3/3 |

Sorties : `etape-52-regressions-sortie.txt`. Observé (52) : deux retraits simultanés → 200 / 400, solde
0,8 → 0,3 BTC, 0,5 BTC reçu ; recovery à 31 800 sats de frais sur 100 000 → 403, à 318 sats → signée ; bon code après
5 échecs → 429, autre client non touché.

Instabilité observée une fois : `validate:10` a échoué sur `ECONNRESET` (connexion réutilisée au moment où le serveur la
fermait), puis a réussi à la relance. Cause non confirmée.
