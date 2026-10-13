# Étape 57 — Passage du seuil de 820 px sans perdre un formulaire

## Problème (observé à l'étape 47)

`Account` (Bitcoin) et `Ethereum` rendaient deux arbres différents selon `mobile` (fragment en téléphone, grille en
ordinateur). Franchir 820 px de large (rotation d'une tablette, fenêtre redimensionnée) remontait tous les composants de
la page : le changement de contact en cours, sa saisie et sa préparation étaient effacés.

## Modification

- `client/src/wallet/Account.tsx`, `client/src/wallet/Ethereum.tsx` : le même arbre dans les deux mises en page
  (`crypto-grid` > `crypto-main` + `crypto-side`) ; seule la classe change.
- `client/src/index.css` : en téléphone (`.crypto-grid.stack`), une colonne flexible ; `crypto-main` en `display: contents`
  et `order` pour garder l'ordre d'avant (en-tête, panneau latéral, graphique, onglets).

## Validation exécutée

| Commande | Résultat observé |
| --- | --- |
| `npm run validate:57` | 2/2 (`etape-57-sortie.txt`) |
| même test sur le code d'avant (commit `3cecfeb`) | 57-1 échoue : formulaire 0, nom et clé perdus (`etape-57-avant-correction-sortie.txt`) |
| `npm run validate:6:ui` ; `MOBILE=1 …` ; `validate:43` | 19/19 ; 20/20 ; 6/6 (`etape-57-regressions-sortie.txt`) |
| `npx tsc -p client` | succès |

Observé : saisie (« Bob », clé du contact) conservée à 390 px puis à 1280 px ; changement préparé conservé à 390 px ;
mise en page téléphone vérifiée sur la capture `captures/etape-57-1-telephone-preparation.png` (en-tête, panneau,
graphique, onglets).
