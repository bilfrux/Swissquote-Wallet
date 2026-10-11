# Étape 28 — Clarifier la passkey du compte bancaire

## Modification

Le panneau de sécurité affiché depuis le nom du client indique désormais que
la passkey sert uniquement à confirmer les montants élevés. La connexion
classique par identifiant et mot de passe reste le seul moyen de connexion
affiché.

Le bouton « Activer une passkey » est affiché uniquement lorsque le backend
indique qu'aucune passkey n'est enregistrée. Il est masqué dès qu'au moins une
passkey est déjà active.

## Validation exécutée

```bash
npm run typecheck
npm run build
git diff --check
```

Résultat observé : les trois commandes réussissent.
