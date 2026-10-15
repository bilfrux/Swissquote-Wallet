# Étape 64 — Ethereum dans l'architecture, `validate:63` dans le README

## Problème

`docs/architecture.md` sur `main` ne mentionnait **jamais** Ethereum (0 occurrence) : trois principes, schéma, flux et
composants ne décrivaient que le Bitcoin, alors que le README, le modèle de menace et le code couvrent Ethereum depuis
l'étape 17. Une version qui couvrait Ethereum existait sur la branche `docs/readme-ethereum-gasless` (commit `59ee31d`,
11 octobre), jamais fusionnée, écrite avant les étapes 38 à 62.

## Modification

- `docs/architecture.md` : reprend la version de cette branche (schéma avec Sepolia, bundler et paymaster de Candide en
  service tiers ; diagramme Safe + module de recovery ; construction d'une opération sans gaz ; flux Ethereum ; composant
  `packages/evm`), complétée par ce que `main` a ajouté depuis : clé Swissquote par compte (56), verrou crypto (38-39),
  wallets liés à l'appareil (40), kit de sortie Bitcoin du Client Wallet (41), politique confirmée dans le wallet (47),
  refus des changements de gardiens hors activation ou changement de contact vérifié (48, 58), changement de contact
  (43, 58), exposition réseau (46), nouvelle tentative sur AA25 et envoi d'USDC validé (63).
- `README.md` : ligne `validate:63` dans les preuves ; l'envoi d'USDC indiqué comme validé dans Chrome avec la biométrie.

## Validation exécutée

| Commande | Résultat observé |
| --- | --- |
| `grep -c -i ethereum docs/architecture.md` | 0 avant, 17 après |
| Relecture des affirmations contre le code et les rapports | chaque point cite une étape dont le rapport existe dans `docs/validation/` ; versions `viem` 2.57.4 et `abstractionkit` 0.4.3 lues dans `packages/evm/package.json` |
| `git diff --check` | succès |

## Non validé

Le rendu Mermaid n'a pas été vérifié dans GitHub avant la publication.
