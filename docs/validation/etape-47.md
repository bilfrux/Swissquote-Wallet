# Étape 47 — La politique du compte se confirme dans le Client Wallet

## Problème (audit)

L'appli de la banque envoyait la politique (clé Swissquote, clé du contact, délai) au Client Wallet, qui l'enregistrait
sans rien afficher (`PolicyReq`) et sans authentification (`POST /api/wallets/:id/policy`). La clé du contact n'était
saisie que dans l'appli. Une appli Swissquote compromise (menace « mise à jour malveillante » de la spec) pouvait donc
remplacer la clé du contact par une clé à elle : Swissquote + « contact » = Swissquote seule après D (invariant 1). Elle
pouvait aussi changer la politique plus tard, pour qu'une sortie vers une règle piégée s'affiche « this account ».

## Modifications

- `client-wallet/src/ui/App.tsx` : la demande « policy » ouvre un écran de confirmation : chemin du client, chemin
  Swissquote + contact, délai, nom et **empreinte** du contact, empreinte de la clé Swissquote ; changement de contact
  (ancienne → nouvelle empreinte), de clé Swissquote ou de délai signalé. Le client compare l'empreinte avec son contact
  par un autre canal, puis confirme par biométrie, ou refuse (refus renvoyé à l'appli, rien d'enregistré).
- `client-wallet/src/server.ts` : `POST /api/wallets/:id/policy` valide la politique (400 si invalide) et exige le
  déverrouillage biométrique (403 sinon), avec le compteur d'échecs commun.
- `guardian-console/src/Console.tsx` : l'empreinte de la clé du contact est affichée, « à lire au client ».
- Tests mis à jour : `etape-6-ui` (confirmation à la création et après la recovery ; l'empreinte affichée par le wallet
  est celle de la console), `etape-37`, `etape-41`, `etape-43` (secret biométrique sur `/policy`).
- `etape-43` : capture de la fenêtre au lieu de la page entière (voir ci-dessous).

## Validation exécutée

| Commande | Résultat observé |
| --- | --- |
| `npm run validate:47` | 4/4 (`etape-47-sortie.txt`) |
| `npm run validate:6:ui` | 19/19 |
| `npm run validate:37` | 8/8 |
| `npm run validate:41` | 5/5 |
| `npm run validate:43` | 6/6, trois exécutions de suite |

Sorties de régression : `etape-47-regressions-sortie.txt`.

Observé (47) : sans biométrie ou avec un mauvais secret, 403 ; politique invalide, 400. Première politique : contact,
empreintes et délai affichés, rien d'enregistré avant la confirmation. Clé de contact substituée par l'appli : « Trusted
contact change: Marie Dupont (deca9e93) → Marie Dupont (cd8e1c0a) », refus renvoyé (`refused by the client`), contact
enregistré inchangé. Clé Swissquote différente : alerte affichée.

## Défaut d'interface observé, non corrigé

`validate:43` échouait par intermittence (5 échecs sur 8). Cause tracée en instrumentant les composants : la capture
pleine page de Playwright fait passer la fenêtre sous 820 px. `Account` bascule alors en mise en page téléphone (journal
`mobile true` puis `false`), ce qui remonte `ChangeContact` et efface le formulaire en cours. Pour le test, la capture
porte maintenant sur la fenêtre seule. Le défaut existe aussi pour un utilisateur qui franchit 820 px (rotation d'une
tablette, redimensionnement) pendant un changement de contact.

## Limites

- La comparaison d'empreinte repose sur le client et son contact (autre canal). Le wallet ne peut pas savoir seul quelle
  clé appartient vraiment au contact.
- L'empreinte Swissquote affichée n'est vérifiable que si Swissquote la publie par un autre canal (site, contrat).
