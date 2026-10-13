# Étape 53 — Petits défauts de qualité

## Modifications

- `packages/bitcoin/src/wallet.ts`, `history()` : une seule découverte des adresses au lieu de deux.
  **Correction de l'audit** : j'avais écrit que cela doublait les requêtes Esplora. Mesuré avec `validate:9:budget` : 15
  requêtes avant comme après, le cache de `EsploraBackend` absorbait la deuxième passe. Le gain est seulement du calcul en
  moins (dérivations d'adresses).
- `packages/evm/src/index.ts`, `readStateOnce` : un seul `getCode` (il était appelé deux fois de suite).
- `guardian-console/src/Console.tsx` : un texte collé qui commence par « { » sans être une demande Ethereum valide faisait
  planter la page (`JSON.parse` pendant le rendu, sans garde). Il affiche maintenant un message d'erreur. Commentaire
  d'en-tête corrigé : la phrase créée est bien gardée en mémoire (état React) le temps de l'afficher une fois.
- `package.json` : `typecheck` vérifie aussi `packages/evm`.
- `scripts/validate/etape-9.ts` : dossier des wallets configurable (`CLIENT_WALLET_DATA`), pour lire les données d'une
  autre copie du dépôt.

## Validation exécutée

| Commande | Résultat observé |
| --- | --- |
| `npm run validate:53` | 1/1 (`etape-53-sortie.txt`) |
| `npm run typecheck` (avec `packages/evm`) | succès |
| `npm run validate:9:budget` | 15 requêtes, identique à avant |
| `CLIENT_WALLET_DATA=<dépôt principal>/client-wallet/data npm run validate:9` | 5/6 |

Observé (53) : « {abc » → « unreadable request (invalid JSON) » ; `{"kind":"autre"}` → « unreadable Ethereum request » ;
texte quelconque → « unreadable PSBT: invalid base64 » ; page utilisable, aucune exception.

## Non validé

`validate:9`, test 9-6 (historique signet réel du wallet CH-0003 d'origine) : échec, et **même échec sur le code
d'origine** (`worktree-docs-soumission`) avec les mêmes données. Il dépend de l'état des données de démo signet (wallet
et `.local/signet-ui/state.json` de la copie principale), pas de cette étape. Les tests 9-1 à 9-5 (regtest et frais signet
réels) passent.
