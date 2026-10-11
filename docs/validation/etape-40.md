# Étape 40 — Les wallets appartiennent à l'appareil, pas au compte Swissquote

## Problème

Sur un nouvel appareil, le site demandait à bank-mock la liste des comptes du client (`/wallet/accounts`) et
affichait « le plus récent » comme son wallet. Le wallet semblait donc rattaché au compte Swissquote, alors que les
clés privées ne sont que sur l'appareil.

## Modification

`client/src/wallet/CryptoTab.tsx` ne contacte plus bank-mock pour savoir quels wallets existent. Le compte actif
(clés **publiques** : clé du wallet, contact de confiance, délai) vient du stockage local de l'appareil.
Sur un appareil sans wallet, le site propose d'en créer un ou la recovery.

Ce qui reste volontairement lié au compte Swissquote : l'enregistrement des clés publiques à la création (Swissquote
est guardian : sans cela, elle ne pourrait pas signer une recovery, qui passe par un re-KYC) et les preuves de
propriété (Travel Rule). Ce n'est plus utilisé pour retrouver un wallet.

## Validation exécutée

```bash
npm run typecheck
npm run validate:40      # sortie : docs/validation/etape-40-sortie.txt
```

Résultat observé : typecheck sans erreur ; `validate:40` : 3 critères sur 3 réussis (un compte enregistré chez Swissquote
n'est pas repris sur un appareil vierge ; un appareil qui a le wallet l'ouvre ; aucune requête `/wallet/accounts` dans les
deux cas). Captures : `captures/etape-40-1-appareil-vierge.png`, `etape-40-2-appareil-avec-wallet.png`.

## Limites

- Le cache est dans le `localStorage` du navigateur. Si on le vide, le site ne retrouve plus le wallet, même si le
  Client Wallet garde la clé et la politique. Le kit de sortie (étape 41) repart du Client Wallet, pas du cache.
- Changer de navigateur ou d'appareil, c'est un « autre appareil » : il faut créer un wallet ou faire la recovery.
- La route `/wallet/accounts` de bank-mock existe toujours (elle n'est plus appelée par l'appli).
