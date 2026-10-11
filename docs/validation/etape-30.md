# Étape 30 — Afficher les règles de passkey

## Modification

Le panneau de sécurité affiche désormais :

```text
Passkey activée
La passkey permet de signer les montants importants :
- Bitcoin : au-delà de 0,2 BTC
- Ethereum / USDC : seuil non configuré
```

Le seuil Ethereum/USDC est indiqué comme non configuré, car aucun seuil
chiffré n'est actuellement appliqué au flux Ethereum dans le code.

## Validation exécutée

```bash
npm run typecheck
npm run build
git diff --check
```

Résultat observé : les trois commandes réussissent.
