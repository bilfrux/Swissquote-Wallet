# Étape 13 : interface entièrement en anglais

## Livré

- Appli (`client/`), Wallet du client (`client-wallet/`), console du tiers (`guardian-console/`) : tous les textes affichés, `lang="en"`, titres des pages.
- Messages d'erreur, alertes, emails simulés, enregistrements Travel Rule et données de démo de la banque (libellés des comptes et opérations) : en anglais, côté `bank-mock/`, `client-wallet/` et `packages/bitcoin/`.
- Panneau « Attacks » : titres, étapes et verdicts (`scripts/attacks/attacks.ts`).
- Scripts de test mis à jour pour chercher les textes anglais (`etape-6-ui.ts`, `etape-8-signet-ui.ts`, `etape-4-ui.ts`, assertions de `etape-7/8-alerts/11`).

## Résultats observés

| Commande | Résultat |
| --- | --- |
| `npm run typecheck` | OK (7 projets) |
| `validate:6:ui` | ordinateur 19/19, téléphone 20/20 (`etape-13-ui-*-sortie.txt`) |
| `validate:1`, `2`, `3`, `7`, `8:pin`, `8:alerts`, `9`, `10`, `11`, `12`, `inv5`, `test:attacks` | tous passent (`etape-13-regressions-sortie.txt`) |

## Non couvert

- Non traduits : README, `docs/`, SPEC.md, libellés des rapports de test (restent en français).
- Valeurs internes gardées en français car stockées ou comparées : statuts des enregistrements Travel Rule en base (`envoyé`, `crédité`…) et types d'historique (`reçu`, `envoyé`…). L'interface les affiche en anglais via une table de correspondance. Une base `bank-mock` créée avant ce changement garde ses anciens textes français (alertes, Travel Rule déjà enregistrés).
- Scripts d'anciennes interfaces (`etape-1-ui`, `etape-2-ui`, `etape-3-ui`) : non adaptés ni relancés ; ils ciblaient déjà l'ancienne interface (avant la refonte).
- Parcours signet (`validate:8:signet`) : textes adaptés, non exécuté.
- Textes générés par la bibliothèque ou le nœud Bitcoin : inchangés (déjà en anglais).
