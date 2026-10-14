# Étape 50 — Durcissement du Client Wallet

## Problèmes (audit)

1. Le serveur acceptait encore `set-pin` et `remove-bio` : un wallet biométrique pouvait reprendre une copie chiffrée par
   un PIN de 6 chiffres, cassable hors ligne, contrairement à l'étape 36. La vérification préalable de l'interface
   (`op: "check"`) n'existait pas côté serveur : l'erreur « unknown operation » était ignorée, rien n'était vérifié.
2. Montant élevé : seule la première sortie externe était confirmée (`confirmTarget = external[0]`). Un PSBT à deux
   sorties externes faisait vérifier une petite sortie et envoyait l'essentiel ailleurs.
3. Une nouvelle demande `postMessage` remplaçait la demande en cours, alors que l'ancienne description restait affichée
   le temps de décoder la nouvelle. Le client pouvait signer B en voyant A.

## Modifications

- `client-wallet/src/server.ts` : `/unlock` n'accepte plus que `set-bio` (passage à la biométrie, le PIN est supprimé)
  et `check` (vérifie le déverrouillage sans rien changer). Montant élevé vers plus d'un destinataire externe : refusé.
- `client-wallet/src/ui/App.tsx` : une demande reçue pendant qu'une autre attend la décision du client est refusée
  (réponse d'erreur à l'appli). Chaque écran est remonté par identifiant de demande (`key`). Écran de montant élevé : refus
  affiché s'il y a plusieurs destinataires. La vérification préalable avant de créer une passkey utilise `check`.

## Validation exécutée

| Commande | Résultat observé |
| --- | --- |
| `npm run validate:50` | 3/3 (`etape-50-sortie.txt`) |
| `npm run validate:37` ; `validate:41` ; `validate:42` | 8/8 ; 5/5 ; 2/2 |
| `npm run validate:6:ui` | 19/19 |
| `npx tsc -p client-wallet` | succès |

Observé (50) : `set-pin` et `remove-bio` → 400. `check` avec un mauvais PIN → 403, avec le bon → 200 sans modification.
0,51 BTC vers deux destinataires → 400 « several recipients », même avec les 6 caractères du premier ; vers un seul
destinataire → signé. Deuxième demande pendant la confirmation → refusée (« another request is already waiting… »).
L'écran garde la première demande, et c'est elle qui est signée. Sorties de régression : `etape-50-regressions-sortie.txt`.
