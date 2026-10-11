# Étape 32 — Harmoniser le visuel du Client Wallet

## Modification

Le Client Wallet utilise désormais le logo Swissquote déjà présent dans le
projet, avec le nom « Client Wallet » et une mention explicite de son
indépendance et du stockage local des clés.

L'interface reprend aussi une palette claire, des bordures et des boutons plus
proches de la direction artistique Swissquote, sans modifier les demandes de
signature ou la logique de sécurité.

## Validation exécutée

```bash
npm run typecheck
cd client-wallet && npx vite build
git diff --check
```

Résultat observé : les trois commandes réussissent.

La commande `npm run build -w client-wallet` n'est pas disponible, car ce
workspace ne déclare pas de script `build`; la compilation Vite directe a été
utilisée.
