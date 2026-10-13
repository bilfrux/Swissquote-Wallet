# Étape 56 — Une clé Swissquote par compte

## Problème (audit)

Tous les clients partageaient la clé de compte Swissquote `m/48'/1'/0'/2'` (même clé publique au même index), et
l'adresse de gardien Ethereum `m/44'/60'/0'/0/0`. Chaque script P2WSH révélé on-chain porte la clé publique de Swissquote,
et la liste des gardiens d'un Safe est publique : on pouvait relier entre eux les comptes de tous les clients Swissquote.

## Modifications

- `packages/bitcoin/src/keys.ts` : `accountKeyAt(master, index)` (compte BIP48 `m/48'/1'/<index>'/2'`).
  `packages/evm/src/keys.ts` : `evmAccountFromMnemonic(mnemonic, addressIndex)`.
- `bank-mock/src/guardian.ts` : index de compte tiré de la clé publique du client (SHA-256, durci, jamais 0) ; clé Bitcoin
  `swissquoteKeyFor(network, clientKey)` ; adresse de gardien Ethereum par index. Aucun secret stocké en plus.
- `bank-mock` : colonnes `accounts.swissquote_key` et `evm_accounts.sq_index` (vides = clé historique, comptes d'avant cette
  étape). `GET /guardian/key` exige `client` (400 sinon) ; `POST /accounts/register` recalcule la clé du compte (une clé
  imposée par l'appli est ignorée) et la renvoie ; `GET /guardian/evm-address` exige `owner` ; comptes, configurations,
  changement de contact, alertes, custody et signature des recovery utilisent la clé du compte.
- Appli : la clé Swissquote est demandée APRÈS la création de la clé client (`CreateWallet`), et vérifiée à
  l'enregistrement ; le nouveau compte d'une recovery a sa propre clé (`Recovery`) ; le Safe utilise l'adresse de gardien
  propre au compte (`Ethereum`).
- Tests mis à jour : `etape-2`, `3`, `7`, `8-alerts`, `11`, `12`, `43`, `52`, `54`. Non mis à jour (scripts anciens, qui
  visent l'ancienne interface ou des comptes signet existants, à clé historique) : `etape-2-ui`, `etape-3-signet`,
  `etape-8-signet-ui`.

## Validation exécutée

| Commande | Résultat observé |
| --- | --- |
| `npm run validate:56` | 4/4 (`etape-56-sortie.txt`) |
| Régressions (`etape-56-regressions-sortie.txt`) | `typecheck` ; `validate:2` 8/8, `3` 7/7, `6:ui` 19/19 et 20/20, `7` 8/8, `8:alerts` 6/6, `11` 6/6, `12` 2/2, `test:attacks` 4/4, `43` 6/6, `52` 4/4, `54` 9/9 (vrai Sepolia) |

Observé (56) : deux clients → `[e6d2cc19/48'/1'/1005488413'/2']…` et `[e6d2cc19/48'/1'/500652030'/2']…`, clés publiques
Swissquote différentes à l'index 0, même empreinte ; même compte → même clé ; sans clé client → 400. Clé imposée par
l'appli ignorée. Recovery signée avec la clé du compte, refusée avant D, acceptée à D. Compte historique (ligne sans clé
propre, insérée dans la base) : listé avec l'ancienne clé, recovery toujours signée.
`validate:43` a d'abord échoué sur une variable déclarée deux fois dans le test (ma modification), puis 6/6.
