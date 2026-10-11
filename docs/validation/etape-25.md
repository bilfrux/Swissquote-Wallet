# Étape 25 : valorisation des actifs de test

## Objectif

Ne pas présenter les BTC Signet/regtest ni les USDC Sepolia comme une valeur CHF réelle
ou comme une variation financière réelle.

## Modifications

- La valeur totale et la variation journalière du wallet affichent `—`.
- Les colonnes `Value CHF` et `24h` des positions affichent `—`.
- Le compteur `Assets` compte uniquement les positions dont le solde réel est positif :
  BTC self-custody, USDC effectivement détenus et BTC en custody Swissquote.
- Les quantités et les soldes de test restent affichés dans leur unité native.

## Validation observée

| Commande | Résultat |
| --- | --- |
| `npm run typecheck` | succès |
| `cd client && npx vite build` | succès |
| `git diff --check` | succès |

Le build produit un avertissement de taille de bundle existant, sans erreur.
