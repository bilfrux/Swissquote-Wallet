# Étape 48 — Ethereum : refus des changements de gardiens et des seuils sous 2

## Problème (audit)

`describeCall` (packages/evm) décodait `addGuardianWithThreshold` et `revokeGuardianWithThreshold` en clair, sans
risque : le Client Wallet les signait. Une appli compromise pouvait demander `addGuardianWithThreshold(attaquant, 1)` :
un seul gardien aurait alors pu démarrer et finaliser une recovery (contre l'invariant 1), ou remplacer le contact par
sa propre adresse.

## Modification

`packages/evm/src/index.ts`, `describeOp` : règles sur l'ensemble de l'opération (un lot s'exécute en entier).
- Seul changement de gardiens accepté : l'activation initiale (celle de `activationCalls`) : module de recovery activé
  dans le même lot, exactement deux gardiens distincts, ni le Safe ni son propriétaire, seuil final 2, aucun retrait.
- Sinon, chaque ajout ou retrait de gardien porte un risque, et le Client Wallet refuse de signer (il refusait déjà
  tout appel avec un risque). Message explicite si le seuil final est inférieur à 2.
- `client-wallet/src/server.ts` passe l'adresse du propriétaire à `describeOp`.

Conséquence : changer de contact Ethereum depuis ce wallet n'est pas possible. Ce n'était pas implémenté (l'étape 43
ne concerne que Bitcoin) ; à faire avec un écran dédié, comme la politique Bitcoin (étape 47).

## Validation exécutée

| Commande | Résultat observé |
| --- | --- |
| `npm run validate:48` (hors ligne, encodage abstractionkit comme dans l'appli) | 12/12 (`etape-48-sortie.txt`) |
| `npx tsc -p packages/evm --noEmit && npx tsc -p client-wallet` | succès |

Acceptés : activation de l'appli, envoi d'USDC, annulation d'une recovery. Refusés : gardien de l'attaquant avec
seuil 1, ajout hors activation, activation avec seuil final 1, avec un seul gardien, avec le propriétaire comme gardien,
avec deux fois le même gardien, remplacement du contact (ajout puis retrait), retrait avec seuil 1, activation et retrait
dans le même lot.

## Non validé

Le parcours réel sur Sepolia (`validate:17`, `validate:18`) n'est pas relancé ici : il saisit encore un PIN (étape
suivante).
