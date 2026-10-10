# Étape 3 : recovery Bitcoin, refus avant D, rafraîchissement (porte B)

## Livré

| Élément | Emplacement |
| --- | --- |
| Écran « Récupérer mon compte » : re-KYC, ancien compte retrouvé, nouvelle clé, demande signée par Swissquote, signature du tiers, diffusion avec l'erreur réelle du réseau, bascule sur le nouveau compte. L'état (données publiques) est conservé pendant l'attente de D | `client/src/recovery/Recovery.tsx` |
| Avertissement « bientôt dépensable par Swissquote + tiers » et bouton de rafraîchissement | `client/src/wallet/Account.tsx`, `Send.tsx` (depuis l'étape 1) |
| `POST /accounts/list` (après re-KYC) : clés publiques des comptes du client, pour un nouvel appareil | `bank-mock/src/server.ts` |
| Étiquette « votre nouveau compte » dans la simulation de recovery | `client/src/simulation/PsbtSummary.tsx` |
| Outils de validation communs | `scripts/validate/lib.ts` |

## Commandes

```bash
npm run regtest:up
npm run validate:3                                    # regtest : bank-mock dédié (port 4101)
npm run dev                                           # client, bank-mock (4000), console
npm run validate:3:ui                                 # Chrome headless, 3 profils (CONSOLE_URL / APP_URL si besoin)
npm run validate:3:signet -- prepare | broadcast      # recovery réelle sur signet, bank-mock sur 4000
```

## Résultats regtest (`etape-3-sortie.txt`)

| # | Critère | Verdict |
| --- | --- | --- |
| 1 | Recovery Swissquote + tiers sur deux coins reçus à 2 blocs d'écart : **refusée par le consensus** (`non-BIP68-final`) à 1 conf, puis tant que le coin le plus récent a moins de D conf ; **acceptée à D** ; fonds sur le nouveau compte, ancien compte vide | fonctionne |
| 2 | Rafraîchissement : avertissement affiché à D−2 ; après l'envoi à soi-même, la recovery déjà signée est refusée (`missing-inputs`), et une nouvelle recovery sur le coin rafraîchi est refusée (`non-BIP68-final`) : le délai repart de zéro | fonctionne |
| 3 | Pendant ce temps, le client dépense seul dès 1 confirmation, Swissquote arrêtée | fonctionne |

## Résultats dans le navigateur (`etape-3-ui-sortie.txt`, captures `etape-3-*.png`)

| # | Critère | Verdict |
| --- | --- | --- |
| UI-1 | Ancien appareil : avertissement quand le délai approche | fonctionne |
| UI-2 | Nouvel appareil (autre profil) : re-KYC, ancien compte retrouvé, nouvelle clé enregistrée, demande signée par Swissquote | fonctionne |
| UI-3 | Tiers (troisième profil) : signe dans la console guardian | fonctionne |
| UI-4 | Diffusion avant D : l'appli affiche le refus réel du réseau (`non-BIP68-final`) et le nombre de blocs restants | fonctionne |
| UI-5 | À D : recovery diffusée ; le nouveau compte s'ouvre avec les fonds | fonctionne |
| UI-6 | Ancien appareil : compte vide | fonctionne |
| UI-7 | Aucune erreur dans la console des navigateurs | fonctionne |

## Signet (`etape-3-signet-sortie.txt`)

Coin de l'étape 1 (859 sats, `9203045e…d248:0`, confirmé au bloc 325781) sur le compte n°7. Recovery vers le compte n°8 (nouvelle clé client), signée par Swissquote **via le vrai bank-mock** (port 4000, sa propre clé), après re-KYC, et par le tiers.

| Critère | Verdict |
| --- | --- |
| Diffusion à 1 confirmation : **refusée par le réseau signet** (`sendrawtransaction RPC error -26: non-BIP68-final`) | fonctionne |
| Diffusion à 6 confirmations (bloc 325786) : **acceptée par le réseau signet** : 859 sats dépensés par le chemin Swissquote + tiers, 700 sats vers le nouveau compte n°8 (`tb1qv37a3kg6dna8zd252paegjfejrvepsp4cagaeg5kj54y7dvqfw4qyn4xqp`), 159 sats de frais | fonctionne |

Transaction de recovery réelle : [d26b94de30f36cbfa8b1a7f39976bf74a09e7afafda09b7a66a916b37326c519](https://blockstream.info/signet/tx/d26b94de30f36cbfa8b1a7f39976bf74a09e7afafda09b7a66a916b37326c519). Observé : diffusion acceptée par l'API Esplora. La confirmation en bloc n'a pas été vérifiée au moment de l'écriture.
