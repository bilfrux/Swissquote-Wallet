# Étape 36 — Biométrie comme déverrouillage du Client Wallet

## Modification

Le Client Wallet n'affiche plus le PIN comme méthode normale :

- les nouveaux wallets sont créés uniquement avec une biométrie WebAuthn/PRF ;
- les signatures Bitcoin et Ethereum utilisent uniquement la biométrie ;
- les anciens wallets protégés seulement par PIN affichent une migration vers la
  biométrie au lieu de proposer le PIN pour signer ;
- la protection d'un ancien wallet en clair utilise directement la biométrie ;
- après migration, l'ancienne protection PIN est supprimée.

Le support serveur du format PIN historique reste conservé uniquement pour
permettre la migration des wallets déjà présents sur l'appareil.

## Validation exécutée

```bash
npm run typecheck
cd client-wallet && npx vite build
git diff --check
```

Résultat observé : les trois commandes réussissent.

Dans le navigateur sur `http://localhost:5180/`, le texte affiché a été vérifié :

- `Phrase encrypted · unlock with biometrics required`
- `Enable biometrics`
- `Protect with biometrics`

Aucune option `Wallet PIN`, `Add a PIN` ou `Use my PIN instead` n'est
affichée dans l'interface.
