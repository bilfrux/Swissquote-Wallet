# Étape 33 — Harmoniser la console du tiers de confiance

## Modification

La console indépendante du tiers de confiance utilise désormais le logo
Swissquote, le nom « Trusted Contact », la mention « Guardian console » et la
palette claire avec accent orange du Client Wallet.

Les cartes, formulaires, boutons, identités et avertissements ont été
harmonisés sans modifier la génération de clé, la signature des recoveries ou
le stockage éphémère de la phrase.

## Validation exécutée

```bash
npm run build -w @sq/guardian-console
npm run typecheck
git diff --check
```

Résultat observé : les trois commandes réussissent.
