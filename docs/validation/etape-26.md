# Étape 26 : stabilité de la fenêtre Client Wallet

## Problème observé

La fenêtre ouverte sur `http://localhost:5180/` affichait brièvement son en-tête,
puis disparaissait après un crash React :

```text
Cannot destructure property 'pin' of 'w.unlock' as it is undefined
```

Les anciens wallets stockés avant l'ajout du champ `unlock` provoquaient ce crash.
Par ailleurs, l'origine de l'application appelante doit être présente dans
`VITE_WALLET_ALLOWED_ORIGINS` ; le lancement sur le port `5183` utilise le script
`scripts/demo/signet-ports.sh` qui configure cette origine explicitement.

## Correction

- Le Client Wallet accepte les anciens objets `WalletView` sans `unlock`.
- Les réglages utilisent des valeurs sûres lorsque ce champ est absent.
- Les origines autorisées sont nettoyées avant comparaison.

## Validation observée

| Commande | Résultat |
| --- | --- |
| `npm run typecheck` | succès |
| `cd client-wallet && npx vite build` | succès |
| Rechargement de `http://localhost:5180/` dans le navigateur | la page reste affichée et la liste des wallets est visible |
