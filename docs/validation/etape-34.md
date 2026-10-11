# Étape 34 — Valoriser les actifs des testnets

## Modification

Le portefeuille affiche maintenant les valeurs en CHF à partir des quantités
réelles détenues et des prix de marché BTC/USDC :

- BTC self-custody : quantité BTC × prix BTC ;
- BTC conservé chez Swissquote : quantité BTC × prix BTC ;
- USDC sur Ethereum Sepolia : quantité USDC × prix USDC ;
- valeur totale : somme des positions ;
- variation du jour : variation CHF calculée avec la variation 24 h du marché.

Les quantités de testnet sont donc valorisées avec les prix actuels des tokens
sur le mainnet, sans leur attribuer une valeur spécifique au réseau de test.
Le seuil Ethereum/USDC n'est pas modifié par cette évolution.

## Validation exécutée

```bash
npm run typecheck
npm run build
git diff --check
```

Résultat observé : les trois commandes réussissent.
