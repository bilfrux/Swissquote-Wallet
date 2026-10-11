# Étape 29 — Reformuler le libellé de la passkey

## Modification

Le panneau de sécurité affiche désormais :

```text
Passkey : activée (1)
La passkey permet de signer les gros montants.
```

## Validation exécutée

```bash
npm run typecheck
npm run build
git diff --check
```

Résultat observé : les trois commandes réussissent.
