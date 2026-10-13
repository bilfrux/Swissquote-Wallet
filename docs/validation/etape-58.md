# Étape 58 — Changer de contact de confiance sur Ethereum

## Problème

Depuis l'étape 48, le Client Wallet refusait tout changement de gardien hors activation : impossible de remplacer un
contact perdu ou indisponible sur Ethereum (le changement Bitcoin existait depuis l'étape 43).

## Modifications

- `packages/evm` : `contactChangeCalls(old, new, guardians, pending)` construit un lot unique : annulation d'une recovery
  en cours si besoin (le retrait d'un gardien ne l'annule pas, module v0.0.1), retrait de l'ancien contact (seuil 1 le
  temps du lot), ajout du nouveau (seuil 2), invalidation des signatures déjà collectées. `describeOp` accepte ce motif
  seulement si les gardiens actuels sont fournis : un gardien actuel retiré, une nouvelle adresse ajoutée (ni gardien, ni
  Safe, ni propriétaire), deux gardiens et seuil 2 à la fin, aucun autre appel. Il renvoie `contactChange: { from, to }`.
- `client-wallet` : les gardiens sont lus on-chain par le wallet lui-même ; l'écran de confirmation affiche « Change of
  trusted contact », l'adresse retirée (doit être celle du contact, pas de Swissquote) et l'adresse ajoutée (à vérifier
  avec le nouveau contact, dans sa console).
- `bank-mock` : `POST /evm/accounts/tiers` (biométrie exigée) met le registre à jour seulement si la chaîne, lue au bloc
  de l'opération, montre le changement (nouveau contact gardien, ancien non, Swissquote toujours, seuil 2) ; alerte au client.
- Appli (`Ethereum.tsx`, onglet Sécurité) : contact affiché, « Change my trusted contact » (nom, adresse), préparation,
  signature dans le Client Wallet, puis mise à jour chez Swissquote.

## Validation exécutée

| Commande | Résultat observé |
| --- | --- |
| `npm run validate:58` (vrai Sepolia) | 6/6 (`etape-58-sortie.txt`) |
| `npm run validate:48` (hors ligne) | 20/20, dont 8 cas de changement de contact |
| `npm run validate:54` (vrai Sepolia) ; `npm run typecheck` | 9/9 ; succès (`etape-58-regressions-sortie.txt`) |

Observé (58) : écran du wallet avec l'ancienne adresse `0xd778…` et la nouvelle `0x3CC7…` ; changement `0x6d5a2beb…` ;
gardiens on-chain = Swissquote + nouveau contact, seuil 2 ; registre Swissquote « Bob Martin » ; relais : signature de
l'ancien contact refusée (400), du nouveau acceptée. Hors ligne : refusé si le wallet ne connaît pas les gardiens, vers
le propriétaire, vers un gardien existant, en retirant une adresse qui n'est pas gardien, avec un seuil final 1, ou mêlé
à un envoi d'USDC.

## Limite

Le wallet ne sait pas lequel des deux gardiens est Swissquote : une appli compromise pourrait proposer de retirer
Swissquote au lieu du contact. L'écran demande au client de reconnaître l'adresse retirée comme celle de son contact.
