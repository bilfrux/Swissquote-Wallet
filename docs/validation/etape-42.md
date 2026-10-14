# Étape 42 — Activer la biométrie d'un ancien wallet depuis la demande de signature

## Problème observé

Sur la démo (`localhost:5183`), en signant un envoi de 2 USDC, le Client Wallet affichait :
« Biometrics must be enabled before this wallet can be used. Open the wallet settings below to enable them. »
mais aucun réglage n'était visible : pendant une demande de signature, la liste des wallets (donc leurs réglages)
n'est pas affichée. Le message renvoyait vers un « ci-dessous » inexistant.

Cause du message lui-même : les wallets de `client-wallet/data/wallets.json` sont tous protégés par un ancien PIN ou en
clair, aucun par biométrie (vérifié sans afficher de secret). Depuis l'étape 36, un tel wallet ne signe plus avec le PIN :
il doit d'abord migrer vers la biométrie.

## Modification

`client-wallet/src/ui/App.tsx` : le message devient « Enable them in the wallet settings, then come back to this
request » et un bouton « Open wallet settings » affiche la liste des wallets pendant la demande, d'où « Enable
biometrics » (migration par l'ancien PIN, ou « Protect with biometrics » pour un wallet en clair).

## Validation exécutée

```bash
npm run typecheck
npm run validate:42      # sortie : docs/validation/etape-42-sortie.txt
```

Résultat observé : `validate:42` : 2 critères sur 2 réussis (wallet à PIN seul + demande de preuve de propriété :
message et bouton affichés, réglages absents avant le clic ; après le clic, « Enable biometrics » apparaît et demande
l'ancien PIN). Captures : `captures/etape-42-1-biometrie-requise.png`, `etape-42-2-reglages-activer-biometrie.png`.

## Limites

- **La création réelle de la passkey (Touch ID / Face ID) n'est pas exercée** : le test s'arrête au champ PIN. Que le
  navigateur et l'appareil acceptent l'extension WebAuthn PRF (le secret qui chiffre la phrase) n'est pas confirmé ici ;
  sinon l'activation échoue avec « this device's biometrics cannot protect your phrase ».
- La vérification du PIN avant la création de la passkey ne vérifie rien (l'opération `check` est refusée comme
  « unknown operation ») : un mauvais PIN peut laisser une passkey orpheline. Non corrigé.
- Il y a de nombreux wallets de test « after recovery » dans ce stockage : seul un wallet avec politique enregistrée
  peut servir à dépenser.
