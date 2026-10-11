# Étape 35 — Ouvrir directement le déverrouillage USDC

## Modification

Le bouton « Envoyer des USDC » prépare désormais l'opération puis lance
directement la demande de signature au Client Wallet. L'utilisateur n'a plus
besoin de cliquer une seconde fois sur « Signer avec mon Client Wallet » :
la fenêtre du wallet s'ouvre et demande immédiatement le PIN ou la biométrie.

Les opérations d'activation et de recovery conservent leur étape de
préparation séparée.

## Validation exécutée

```bash
npm run typecheck
npm run build
git diff --check
```

Résultat observé : les trois commandes réussissent.
